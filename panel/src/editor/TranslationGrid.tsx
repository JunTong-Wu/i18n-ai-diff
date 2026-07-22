import { useEffect, useMemo, useRef } from 'react';
import { ListTable, type ColumnsDefine, type ListTableConstructorOptions, type TYPES } from '@visactor/vtable';
import { TextAreaEditor, type RectProps } from '@visactor/vtable-editors';
import { usePanelI18n } from '../i18n';
import type { PanelEditorManifest, PanelEditorRow } from '../types';
import { draftIdentity, effectiveCellValue, type DraftMap } from './model';

const DEFAULT_TABLE_ROW_HEIGHT = 48;
const EDITOR_MIN_HEIGHT = 56;
const EDITOR_BORDER_WIDTH = 2;
const TABLE_CELL_FONT_SIZE = 13;
const TABLE_CELL_LINE_HEIGHT = 20;
const TABLE_CELL_PADDING: [number, number, number, number] = [8, 12, 8, 12];
const KEY_PATH_CELL_PADDING: [number, number, number, number] = [8, 12, 8, 14];
const TABLE_CELL_TEXT_BASELINE = 'top';
const KEY_PATH_LINE_CLAMP = 3;
const COPY_CELL_LINE_CLAMP = 5;

class CopyTextAreaEditor extends TextAreaEditor {
  override adjustPosition(rect: RectProps) {
    if (!this.element) return;
    const offset = EDITOR_BORDER_WIDTH / 2;
    const height = Math.max(rect.height + EDITOR_BORDER_WIDTH, EDITOR_MIN_HEIGHT);
    this.element.style.top = `${rect.top - offset}px`;
    this.element.style.left = `${rect.left - offset}px`;
    this.element.style.width = `${rect.width + EDITOR_BORDER_WIDTH}px`;
    this.element.style.height = `${height}px`;
  }
}

const textAreaEditor = new CopyTextAreaEditor();

export interface GridValueChange {
  pointer: string;
  lang: string;
  changedValue: string | number;
}

export interface GridSelectionCell {
  pointer: string;
  lang: string;
}

export type GridCellTranslationState = 'queued' | 'translating' | 'failed' | 'ai';

export interface GridFocusCell extends GridSelectionCell {
  nonce: number;
}

export type GridContextMenuRequest =
  | {
    kind: 'cell';
    x: number;
    y: number;
    clickedCell: GridSelectionCell;
    selectedCells: GridSelectionCell[];
  }
  | {
    kind: 'row';
    x: number;
    y: number;
    pointer: string;
  }
  | {
    kind: 'language';
    x: number;
    y: number;
    lang: string;
  }
  | {
    kind: 'master-language';
    x: number;
    y: number;
    lang: string;
  };

interface TranslationGridProps {
  rows: PanelEditorRow[];
  manifest: PanelEditorManifest;
  drafts: DraftMap;
  editable: boolean;
  focusCell?: GridFocusCell;
  translationStates?: Map<string, GridCellTranslationState>;
  onChangeValues(values: GridValueChange[]): void;
  onContextMenu?(request: GridContextMenuRequest): void;
  onSelectionChange?(cells: GridSelectionCell[]): void;
}

interface GridRecord extends Record<string, unknown> {
  pointer: string;
  keyPath: string;
  __states: Record<string, {
    kind: 'string' | 'missing' | 'unsupported';
    changed: boolean;
    pending: boolean;
    skipped: boolean;
    translationState?: GridCellTranslationState;
  }>;
}

export function TranslationGrid(props: TranslationGridProps) {
  const { t } = usePanelI18n();
  if (props.rows.length === 0) {
    return (
      <div className="editor-table-empty">
        <strong>{t('editor.noMatchingKeys')}</strong>
        <span>{t('editor.clearFilters')}</span>
      </div>
    );
  }

  return <TranslationGridTable {...props} />;
}

function TranslationGridTable({
  rows,
  manifest,
  drafts,
  editable,
  focusCell,
  translationStates,
  onChangeValues,
  onContextMenu,
  onSelectionChange,
}: TranslationGridProps) {
  const { t } = usePanelI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<ListTable | null>(null);
  const recordsRef = useRef<GridRecord[]>([]);
  const onChangeRef = useRef(onChangeValues);
  const onContextMenuRef = useRef(onContextMenu);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onChangeRef.current = onChangeValues;
  onContextMenuRef.current = onContextMenu;
  onSelectionChangeRef.current = onSelectionChange;

  const records = useMemo<GridRecord[]>(() => rows.map(row => {
    const record: GridRecord = {
      pointer: row.pointer,
      keyPath: row.displayPath,
      __states: {},
    };
    for (const lang of manifest.languages) {
      const cell = row.cells[lang];
      const changed = drafts.has(draftIdentity(lang, row.pointer));
      record[lang] = effectiveCellValue(row, lang, drafts);
      record.__states[lang] = {
        kind: cell?.kind || 'missing',
        changed,
        pending: cell?.pending || false,
        skipped: cell?.skipped || false,
        translationState: translationStates?.get(draftIdentity(lang, row.pointer)),
      };
    }
    return record;
  }), [drafts, manifest.languages, rows, translationStates]);
  recordsRef.current = records;

  const targetLanguages = useMemo(() => new Set(
    manifest.routes.flatMap(route => route.languages.filter(lang => lang !== route.sourceLang)),
  ), [manifest.routes]);
  const masterLanguages = useMemo(() => new Set(
    manifest.routes.map(route => route.sourceLang),
  ), [manifest.routes]);

  const columns = useMemo<ColumnsDefine>(() => {
    const keyColumn = {
      field: 'keyPath',
      title: t('editor.keyPath'),
      width: 290,
      minWidth: 220,
      maxWidth: 420,
      disableColumnResize: false,
      style: {
        bgColor: '#F8FAFD',
        color: '#27364A',
        fontSize: TABLE_CELL_FONT_SIZE,
        fontWeight: 600,
        lineHeight: TABLE_CELL_LINE_HEIGHT,
        padding: KEY_PATH_CELL_PADDING,
        textBaseline: TABLE_CELL_TEXT_BASELINE,
        autoWrapText: true,
        lineClamp: KEY_PATH_LINE_CLAMP,
        borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
      },
      headerStyle: {
        bgColor: '#F2F6FB',
        color: '#101828',
        fontSize: 13,
        fontWeight: 700,
        padding: [8, 12, 8, 14],
        borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
      },
    };
    const groups = manifest.routes.map(route => ({
      title: t('editor.routeTitle', { sourceLang: route.sourceLang }),
      headerStyle: {
        bgColor: '#F8FAFD',
        color: '#5D6979',
        fontSize: 12,
        fontWeight: 650,
        padding: [6, 12, 6, 12],
        borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
      },
      columns: route.languages.map(lang => ({
        field: lang,
        key: lang,
        title: lang === route.sourceLang ? `${lang}  ·  ${t('common.master')}` : lang,
        width: 250,
        minWidth: 190,
        maxWidth: 420,
        fieldFormat: (record: GridRecord) => {
          const state = record.__states[lang];
          if (state.kind === 'unsupported') return t('editor.nonStringValue');
          if (state.kind === 'missing' && !state.changed) return t('common.missing');
          const value = record[lang];
          return value === '' ? t('common.emptyString') : value;
        },
        editor: ((args: { col: number; row: number; table: ListTable }) => {
          const record = args.table.getCellOriginRecord(args.col, args.row) as GridRecord | undefined;
          return editable && record?.__states[lang]?.kind !== 'unsupported' ? textAreaEditor : undefined;
        }) as never,
        style: (args: { col: number; row: number; table: ListTable }) => {
          const record = args.table.getCellOriginRecord(args.col, args.row) as GridRecord | undefined;
          const state = record?.__states[lang];
          const isMissing = state?.kind === 'missing' && !state.changed;
          const isUnsupported = state?.kind === 'unsupported';
          const isSkipped = state?.skipped && !state.changed;
          const translationState = state?.translationState;
          return {
            bgColor: translationState === 'failed'
              ? '#FEF3F2'
              : translationState === 'translating' || translationState === 'queued'
                ? '#F8FAFD'
                : translationState === 'ai'
                  ? '#ECFDF5'
                  : state?.changed
              ? '#EDF4FF'
              : isUnsupported
                ? '#F3F5F8'
                : isSkipped
                  ? '#F5F1FF'
                  : state?.pending
                    ? '#FFFAF0'
                    : '#FFFFFF',
            color: isUnsupported || isMissing ? '#7B8797' : '#101828',
            fontSize: TABLE_CELL_FONT_SIZE,
            fontStyle: isMissing || isUnsupported ? 'italic' : 'normal',
            fontWeight: state?.skipped ? 600 : 400,
            lineHeight: TABLE_CELL_LINE_HEIGHT,
            padding: TABLE_CELL_PADDING,
            textBaseline: TABLE_CELL_TEXT_BASELINE,
            autoWrapText: true,
            lineClamp: COPY_CELL_LINE_CLAMP,
            cursor: editable && !isUnsupported ? 'text' : 'default',
            marked: translationState === 'failed'
              ? { shape: 'triangle', position: 'right-top', size: 8, bgColor: '#D92D20' }
              : translationState === 'translating' || translationState === 'queued'
                ? { shape: 'triangle', position: 'right-top', size: 8, bgColor: '#7C3AED' }
                : translationState === 'ai'
                  ? { shape: 'triangle', position: 'right-top', size: 8, bgColor: '#168A59' }
                  : state?.changed
                    ? { shape: 'triangle', position: 'right-top', size: 8, bgColor: '#1467F3' }
              : state?.pending
                ? { shape: 'triangle', position: 'right-top', size: 8, bgColor: '#F59E0B' }
                : false,
            borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
          };
        },
        headerStyle: {
          bgColor: lang === route.sourceLang ? '#F2F6FB' : '#FFFFFF',
          color: '#101828',
          fontSize: 13,
          fontWeight: lang === route.sourceLang ? 750 : 650,
          padding: [8, 12, 8, 12],
          borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
        },
      })),
    }));
    return [keyColumn, ...groups] as ColumnsDefine;
  }, [editable, manifest.routes, t]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const option: ListTableConstructorOptions = {
      records: recordsRef.current,
      columns,
      rowSeriesNumber: {
        title: '',
        width: 42,
        disableColumnResize: true,
        format: (_col, row, table) => {
          if (typeof row !== 'number') return '';
          const headerRows = table?.columnHeaderLevelCount || 0;
          return row >= headerRows ? row - headerRows + 1 : '';
        },
        style: {
          bgColor: '#F8FAFD',
          color: '#7B8797',
          fontSize: 11,
          fontWeight: 600,
          padding: [8, 6, 8, 6],
          textAlign: 'center',
          textBaseline: TABLE_CELL_TEXT_BASELINE,
          cursor: 'pointer',
          borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
        },
        headerStyle: {
          bgColor: '#F2F6FB',
          color: '#7B8797',
          fontSize: 11,
          fontWeight: 600,
          padding: [8, 6, 8, 6],
          textAlign: 'center',
          borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
        },
      },
      frozenColCount: 2,
      maxFrozenWidth: '52%',
      defaultRowHeight: DEFAULT_TABLE_ROW_HEIGHT,
      defaultHeaderRowHeight: [34, 42],
      widthMode: 'standard',
      heightMode: 'autoHeight',
      autoWrapText: true,
      enableLineBreak: true,
      editCellTrigger: ['doubleclick', 'keydown'],
      keyboardOptions: {
        copySelected: true,
        showCopyCellBorder: true,
        pasteValueToCell: editable,
        editCellOnEnter: editable,
        moveFocusCellOnTab: true,
        moveSelectedCellOnArrowKeys: true,
        shiftMultiSelect: true,
      },
      select: { highlightMode: 'cell', headerSelectMode: 'body' },
      hover: { highlightMode: 'row' },
      overscrollBehavior: 'none',
      theme: {
        underlayBackgroundColor: '#FFFFFF',
        bodyStyle: {
          bgColor: '#FFFFFF',
          color: '#101828',
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          borderColor: '#E4E9F1',
          borderLineWidth: 1,
        },
        headerStyle: {
          bgColor: '#F8FAFD',
          color: '#101828',
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          borderColor: '#E4E9F1',
          borderLineWidth: 1,
        },
        selectionStyle: {
          cellBorderColor: '#0F62E9',
          cellBorderLineWidth: 2,
          cellBgColor: 'rgba(15, 98, 233, 0.04)',
        },
        frameStyle: {
          borderColor: '#D7DEE9',
          borderLineWidth: 0,
          cornerRadius: 0,
        },
      },
    };
    const table = new ListTable(containerRef.current, option);
    tableRef.current = table;
    const cellFromPosition = (col: number, row: number): GridSelectionCell | null => {
      const record = table.getCellOriginRecord(col, row) as GridRecord | undefined;
      if (!record) return null;
      const info = table.getCellInfo(col, row);
      const field = typeof info.field === 'string' ? info.field : undefined;
      if (!field || !manifest.languages.includes(field)) return null;
      return { pointer: record.pointer, lang: field };
    };
    const rowPointerFromPosition = (col: number, row: number): string | null => {
      if (!table.isSeriesNumber(col, row)) return null;
      const record = table.getCellOriginRecord(col, row) as GridRecord | undefined;
      return record?.pointer || null;
    };
    const targetLanguageFromHeader = (col: number, row: number): string | null => {
      if (!table.isColumnHeader(col, row)) return null;
      if (row !== table.columnHeaderLevelCount - 1) return null;
      const info = table.getCellInfo(col, row);
      const field = typeof info.field === 'string' ? info.field : undefined;
      return field && targetLanguages.has(field) ? field : null;
    };
    const masterLanguageFromHeader = (col: number, row: number): string | null => {
      if (!table.isColumnHeader(col, row)) return null;
      if (row !== table.columnHeaderLevelCount - 1) return null;
      const info = table.getCellInfo(col, row);
      const field = typeof info.field === 'string' ? info.field : undefined;
      return field && masterLanguages.has(field) ? field : null;
    };
    const collectSelectedCells = (): GridSelectionCell[] => {
      const ranges = table.getSelectedCellRanges();
      const selected = new Map<string, GridSelectionCell>();
      for (const range of ranges) {
        const startCol = Math.min(range.start.col, range.end.col);
        const endCol = Math.max(range.start.col, range.end.col);
        const startRow = Math.min(range.start.row, range.end.row);
        const endRow = Math.max(range.start.row, range.end.row);
        for (let row = startRow; row <= endRow; row += 1) {
          for (let col = startCol; col <= endCol; col += 1) {
            const cell = cellFromPosition(col, row);
            if (!cell) continue;
            selected.set(draftIdentity(cell.lang, cell.pointer), cell);
          }
        }
      }
      return [...selected.values()];
    };
    const handleChange = (event: TYPES.TableEventHandlersEventArgumentMap['change_cell_values']) => {
      const changes = (event.values as Array<{
        recordIndex?: number | number[];
        field?: string | number | string[];
        changedValue: string | number;
      }>).flatMap(value => {
        if (typeof value.recordIndex !== 'number' || typeof value.field !== 'string') return [];
        const record = recordsRef.current[value.recordIndex];
        if (!record || !manifest.languages.includes(value.field)) return [];
        return [{
          pointer: record.pointer,
          lang: value.field,
          changedValue: value.changedValue,
        }];
      });
      if (changes.length > 0) onChangeRef.current(changes);
    };
    let selectedCell: { col: number; row: number } | null = null;
    let selectionFrame = 0;
    const publishSelectedCells = () => {
      if (selectionFrame) window.cancelAnimationFrame(selectionFrame);
      selectionFrame = window.requestAnimationFrame(() => {
        selectionFrame = 0;
        onSelectionChangeRef.current?.(collectSelectedCells());
      });
    };
    const handleSelectedCell = (event: TYPES.TableEventHandlersEventArgumentMap['selected_cell']) => {
      selectedCell = { col: event.col, row: event.row };
      publishSelectedCells();
    };
    const handleSelectedChanged = () => {
      publishSelectedCells();
    };
    const handleContextMenu = (event: TYPES.TableEventHandlersEventArgumentMap['contextmenu_cell']) => {
      const x = event.event instanceof MouseEvent ? event.event.clientX : 0;
      const y = event.event instanceof MouseEvent ? event.event.clientY : 0;
      const rowPointer = rowPointerFromPosition(event.col, event.row);
      if (rowPointer) {
        event.event?.preventDefault();
        onContextMenuRef.current?.({
          kind: 'row',
          x,
          y,
          pointer: rowPointer,
        });
        return;
      }
      const headerLang = targetLanguageFromHeader(event.col, event.row);
      if (headerLang) {
        event.event?.preventDefault();
        onContextMenuRef.current?.({
          kind: 'language',
          x,
          y,
          lang: headerLang,
        });
        return;
      }
      const masterHeaderLang = masterLanguageFromHeader(event.col, event.row);
      if (masterHeaderLang) {
        event.event?.preventDefault();
        onContextMenuRef.current?.({
          kind: 'master-language',
          x,
          y,
          lang: masterHeaderLang,
        });
        return;
      }
      const clickedCell = cellFromPosition(event.col, event.row);
      if (!clickedCell) return;
      event.event?.preventDefault();
      const selectedCells = collectSelectedCells();
      const clickedIdentity = draftIdentity(clickedCell.lang, clickedCell.pointer);
      const menuCells = selectedCells.some(cell => draftIdentity(cell.lang, cell.pointer) === clickedIdentity)
        ? selectedCells
        : [clickedCell];
      onContextMenuRef.current?.({
        kind: 'cell',
        x,
        y,
        clickedCell,
        selectedCells: menuCells,
      });
    };
    const handleBeforeKeydown = (event: TYPES.TableEventHandlersEventArgumentMap['before_keydown']) => {
      if (!editable || (event.code !== 'F2' && event.keyCode !== 113) || !selectedCell) return;
      event.event.preventDefault();
      event.stopCellMoving?.();
      table.startEditCell(selectedCell.col, selectedCell.row);
    };
    table.on('change_cell_values', handleChange as never);
    table.on('selected_cell', handleSelectedCell as never);
    table.on('selected_changed', handleSelectedChanged as never);
    table.on('drag_select_end', handleSelectedChanged as never);
    table.on('contextmenu_cell', handleContextMenu as never);
    table.on('before_keydown', handleBeforeKeydown as never);
    return () => {
      table.off('change_cell_values', handleChange as never);
      table.off('selected_cell', handleSelectedCell as never);
      table.off('selected_changed', handleSelectedChanged as never);
      table.off('drag_select_end', handleSelectedChanged as never);
      table.off('contextmenu_cell', handleContextMenu as never);
      table.off('before_keydown', handleBeforeKeydown as never);
      if (selectionFrame) window.cancelAnimationFrame(selectionFrame);
      table.release();
      tableRef.current = null;
    };
  }, [columns, editable, manifest.languages, masterLanguages, targetLanguages]);

  useEffect(() => {
    tableRef.current?.setRecords(records);
  }, [records]);

  useEffect(() => {
    if (!focusCell || !tableRef.current) return;
    let cancelled = false;
    let frame = 0;
    let retryTimer = 0;
    let attempts = 0;

    const focus = () => {
      if (cancelled) return;
      const table = tableRef.current;
      if (!table) return;
      try {
        const focusAddress = table.getCellAddress(
          (record: GridRecord) => record.pointer === focusCell.pointer,
          focusCell.lang,
        );
        if (!focusAddress) return;
        table.scrollToCell(focusAddress, false);
        table.selectCell(focusAddress.col, focusAddress.row, false, false, true);
        onSelectionChangeRef.current?.([{ lang: focusCell.lang, pointer: focusCell.pointer }]);
      } catch {
        attempts += 1;
        if (attempts <= 8) retryTimer = window.setTimeout(focus, 50);
      }
    };

    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(focus);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(retryTimer);
    };
  }, [focusCell?.lang, focusCell?.nonce, focusCell?.pointer, records]);

  return <div className="translation-grid" ref={containerRef} aria-label={t('editor.localeTable')} />;
}
