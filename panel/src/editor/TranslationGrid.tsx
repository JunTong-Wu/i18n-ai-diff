import { useEffect, useMemo, useRef } from 'react';
import { ListTable, type ColumnsDefine, type ListTableConstructorOptions, type TYPES } from '@visactor/vtable';
import { TextAreaEditor } from '@visactor/vtable-editors';
import type { PanelEditorManifest, PanelEditorRow } from '../types';
import { draftIdentity, effectiveCellValue, type DraftMap } from './model';

const textAreaEditor = new TextAreaEditor();

export interface GridValueChange {
  pointer: string;
  lang: string;
  changedValue: string | number;
}

interface GridRecord extends Record<string, unknown> {
  pointer: string;
  keyPath: string;
  __states: Record<string, {
    kind: 'string' | 'missing' | 'unsupported';
    changed: boolean;
    pending: boolean;
    skipped: boolean;
  }>;
}

export function TranslationGrid({
  rows,
  manifest,
  drafts,
  editable,
  onChangeValues,
}: {
  rows: PanelEditorRow[];
  manifest: PanelEditorManifest;
  drafts: DraftMap;
  editable: boolean;
  onChangeValues(values: GridValueChange[]): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<ListTable | null>(null);
  const recordsRef = useRef<GridRecord[]>([]);
  const onChangeRef = useRef(onChangeValues);
  onChangeRef.current = onChangeValues;

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
      };
    }
    return record;
  }), [drafts, manifest.languages, rows]);
  recordsRef.current = records;

  const columns = useMemo<ColumnsDefine>(() => {
    const keyColumn = {
      field: 'keyPath',
      title: 'Key path',
      width: 290,
      minWidth: 220,
      maxWidth: 420,
      disableColumnResize: false,
      style: {
        bgColor: '#F8FAFD',
        color: '#27364A',
        fontSize: 13,
        fontWeight: 600,
        padding: [12, 14, 12, 16],
        autoWrapText: true,
        lineClamp: 3,
        borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
      },
      headerStyle: {
        bgColor: '#F2F6FB',
        color: '#101828',
        fontSize: 13,
        fontWeight: 700,
        padding: [10, 14, 10, 16],
        borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
      },
    };
    const groups = manifest.routes.map(route => ({
      title: `${route.sourceLang} route`,
      headerStyle: {
        bgColor: '#F8FAFD',
        color: '#5D6979',
        fontSize: 12,
        fontWeight: 650,
        padding: [8, 14, 8, 14],
        borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
      },
      columns: route.languages.map(lang => ({
        field: lang,
        key: lang,
        title: lang === route.sourceLang ? `${lang}  ·  Master` : lang,
        width: 250,
        minWidth: 190,
        maxWidth: 420,
        fieldFormat: (record: GridRecord) => {
          const state = record.__states[lang];
          if (state.kind === 'unsupported') return 'Non-string value';
          if (state.kind === 'missing' && !state.changed) return 'Missing';
          const value = record[lang];
          return value === '' ? 'Empty string' : value;
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
          return {
            bgColor: state?.changed
              ? '#EDF4FF'
              : isUnsupported
                ? '#F3F5F8'
                : isSkipped
                  ? '#F5F1FF'
                  : state?.pending
                    ? '#FFFAF0'
                    : '#FFFFFF',
            color: isUnsupported || isMissing ? '#7B8797' : '#101828',
            fontSize: 13,
            fontStyle: isMissing || isUnsupported ? 'italic' : 'normal',
            fontWeight: state?.skipped ? 600 : 400,
            padding: [10, 14, 10, 14],
            autoWrapText: true,
            lineClamp: 3,
            cursor: editable && !isUnsupported ? 'text' : 'default',
            marked: state?.changed
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
          padding: [10, 14, 10, 14],
          borderColor: ['#E4E9F1', '#E4E9F1', '#E4E9F1', '#E4E9F1'],
        },
      })),
    }));
    return [keyColumn, ...groups] as ColumnsDefine;
  }, [editable, manifest.routes]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const option: ListTableConstructorOptions = {
      records: recordsRef.current,
      columns,
      frozenColCount: 1,
      maxFrozenWidth: '46%',
      defaultRowHeight: 72,
      defaultHeaderRowHeight: [42, 50],
      widthMode: 'standard',
      heightMode: 'standard',
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
      select: { highlightMode: 'cell' },
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
          borderLineWidth: 1,
          cornerRadius: 14,
        },
      },
    };
    const table = new ListTable(containerRef.current, option);
    tableRef.current = table;
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
    const handleSelectedCell = (event: TYPES.TableEventHandlersEventArgumentMap['selected_cell']) => {
      selectedCell = { col: event.col, row: event.row };
    };
    const handleBeforeKeydown = (event: TYPES.TableEventHandlersEventArgumentMap['before_keydown']) => {
      if (!editable || (event.code !== 'F2' && event.keyCode !== 113) || !selectedCell) return;
      event.event.preventDefault();
      event.stopCellMoving?.();
      table.startEditCell(selectedCell.col, selectedCell.row);
    };
    table.on('change_cell_values', handleChange as never);
    table.on('selected_cell', handleSelectedCell as never);
    table.on('before_keydown', handleBeforeKeydown as never);
    return () => {
      table.off('change_cell_values', handleChange as never);
      table.off('selected_cell', handleSelectedCell as never);
      table.off('before_keydown', handleBeforeKeydown as never);
      table.release();
      tableRef.current = null;
    };
  }, [columns, editable]);

  useEffect(() => {
    tableRef.current?.setRecords(records);
  }, [records]);

  if (rows.length === 0) {
    return (
      <div className="editor-table-empty">
        <strong>No matching keys</strong>
        <span>Clear the filters or choose another locale file.</span>
      </div>
    );
  }

  return <div className="translation-grid" ref={containerRef} aria-label="Locale copy table" />;
}
