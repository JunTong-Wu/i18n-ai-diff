import {
  ArrowBendDownRight,
  FileText,
  MagnifyingGlass,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { searchEditorCopy } from '../api';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog } from '../components/ui/dialog';
import { ModalContent, ModalHeader, ModalTitleBlock } from '../components/ui/modal';
import type {
  PanelEditorFile,
  PanelEditorManifest,
  PanelEditorSearchResponse,
  PanelEditorSearchResult,
  PanelEditorSearchStateFilter,
} from '../types';
import { draftIdentity, type DraftMap } from './model';

interface WorkspaceSearchDialogProps {
  open: boolean;
  manifest: PanelEditorManifest | null;
  currentFile: PanelEditorFile | null;
  drafts: DraftMap;
  onOpenChange(open: boolean): void;
  onOpenResult(result: PanelEditorSearchResult): void;
}

type WorkspaceSearchDisplayResult = PanelEditorSearchResult & {
  draft?: boolean;
};

const SEARCH_LIMIT = 200;
const STATE_FILTERS: Array<{ value: PanelEditorSearchStateFilter; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'missing', label: 'Missing' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'master', label: 'Master' },
  { value: 'target', label: 'Target' },
];

export function WorkspaceSearchDialog({
  open,
  manifest,
  currentFile,
  drafts,
  onOpenChange,
  onOpenResult,
}: WorkspaceSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<PanelEditorSearchStateFilter[]>([]);
  const [includeKeys, setIncludeKeys] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<PanelEditorSearchResponse | null>(null);

  useEffect(() => {
    if (!open || !manifest) return undefined;
    const trimmedQuery = query.trim();
    if (!trimmedQuery && selectedStates.length === 0) {
      setResponse(null);
      setError(null);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void searchEditorCopy({
        query: trimmedQuery,
        languages: selectedLanguages,
        states: selectedStates,
        includeKeys,
        limit: SEARCH_LIMIT,
      }, controller.signal)
        .then(setResponse)
        .catch(requestError => {
          if ((requestError as Error).name !== 'AbortError') {
            setError((requestError as Error).message);
            setResponse(null);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [includeKeys, manifest, open, query, selectedLanguages, selectedStates]);

  const results = useMemo(() => {
    if (!manifest) return [];
    return mergeLocalDraftResults({
      apiResults: response?.results || [],
      currentFile,
      drafts,
      includeKeys,
      manifest,
      query: query.trim(),
      selectedLanguages,
      selectedStates,
    });
  }, [currentFile, drafts, includeKeys, manifest, query, response?.results, selectedLanguages, selectedStates]);

  const groups = useMemo(() => groupResultsByFile(results), [results]);
  const readyToSearch = query.trim().length > 0 || selectedStates.length > 0;
  const total = Math.max(response?.total || 0, results.length);

  const toggleLanguage = (lang: string) => {
    setSelectedLanguages(current => (
      current.includes(lang)
        ? current.filter(candidate => candidate !== lang)
        : [...current, lang]
    ));
  };

  const toggleState = (state: PanelEditorSearchStateFilter) => {
    setSelectedStates(current => (
      current.includes(state)
        ? current.filter(candidate => candidate !== state)
        : [...current, state]
    ));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ModalContent className="workspace-search-dialog" size="xl" aria-describedby="workspace-search-description">
        <ModalHeader>
          <ModalTitleBlock
            title="Search workspace"
            descriptionId="workspace-search-description"
            description="Find copy across every configured locale file, then jump straight to the table cell."
          />
        </ModalHeader>

        <label className="workspace-search-input">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <span className="sr-only">Search all locale copy</span>
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search all locale copy…"
          />
        </label>

        <div className="workspace-search-controls">
          <section className="workspace-search-control-group" aria-label="Workspace search languages">
            <span>Languages</span>
            <div className="workspace-search-checkbox-grid">
              <FilterCheckbox
                checked={selectedLanguages.length === 0}
                label="All languages"
                onCheckedChange={checked => {
                  if (checked) setSelectedLanguages([]);
                  else setSelectedLanguages(manifest?.languages || []);
                }}
              />
              {manifest?.languages.map(lang => (
                <FilterCheckbox
                  key={lang}
                  checked={selectedLanguages.includes(lang)}
                  label={lang}
                  onCheckedChange={() => toggleLanguage(lang)}
                />
              ))}
            </div>
          </section>

          <section className="workspace-search-control-group" aria-label="Workspace search states">
            <span>States</span>
            <div className="workspace-search-checkbox-grid">
              {STATE_FILTERS.map(filter => (
                <FilterCheckbox
                  key={filter.value}
                  checked={selectedStates.includes(filter.value)}
                  label={filter.label}
                  onCheckedChange={() => toggleState(filter.value)}
                />
              ))}
            </div>
          </section>

          <section className="workspace-search-control-group is-compact" aria-label="Workspace search options">
            <span>Options</span>
            <div className="workspace-search-checkbox-grid">
              <FilterCheckbox
                checked={includeKeys}
                label="Include key path"
                onCheckedChange={checked => setIncludeKeys(checked === true)}
              />
            </div>
          </section>
        </div>

        <div className="workspace-search-summary" role="status" aria-live="polite">
          {loading
            ? 'Searching locale files…'
            : readyToSearch
              ? `${total} match${total === 1 ? '' : 'es'}${response?.limited ? ` · first ${response.limit}` : ''}`
              : 'Type copy, or choose a state filter.'}
        </div>

        {error && (
          <div className="workspace-search-error" role="alert">
            {error}
          </div>
        )}

        <div className="workspace-search-results">
          {!readyToSearch && (
            <div className="workspace-search-empty">
              <MagnifyingGlass size={24} aria-hidden="true" />
              <span>Search by visible copy first. Add key path matching only when you need structural lookup.</span>
            </div>
          )}

          {readyToSearch && !loading && !error && groups.length === 0 && (
            <div className="workspace-search-empty">
              <FileText size={24} aria-hidden="true" />
              <span>No matching copy found in configured locale files.</span>
            </div>
          )}

          {groups.map(group => (
            <section className="workspace-search-group" key={group.relativePath}>
              <header>
                <FileText size={16} aria-hidden="true" />
                <strong>{group.relativePath}</strong>
                <span>{group.results.length}</span>
              </header>
              <div>
                {group.results.map(result => (
                  <button
                    key={`${result.relativePath}:${result.pointer}:${result.lang}`}
                    type="button"
                    className="workspace-search-result"
                    onClick={() => onOpenResult(result)}
                  >
                    <span className="workspace-search-result-path">
                      <ArrowBendDownRight size={15} aria-hidden="true" />
                      <Highlight value={result.displayPath} ranges={result.keyMatchRanges} />
                    </span>
                    <span className="workspace-search-result-meta">
                      <b>{result.lang}</b>
                      {result.isMaster && <em>Master</em>}
                      {result.cell.pending && <em className="is-pending">Pending</em>}
                      {result.cell.kind === 'missing' && <em>Missing</em>}
                      {result.cell.skipped && <em>Skipped</em>}
                      {result.draft && <em>Draft</em>}
                    </span>
                    <span className="workspace-search-result-copy">
                      {result.value
                        ? <Highlight value={result.value} ranges={result.valueMatchRanges} />
                        : result.cell.kind === 'missing'
                          ? 'Missing'
                          : 'Empty string'}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </ModalContent>
    </Dialog>
  );
}

function mergeLocalDraftResults({
  apiResults,
  currentFile,
  drafts,
  includeKeys,
  manifest,
  query,
  selectedLanguages,
  selectedStates,
}: {
  apiResults: PanelEditorSearchResult[];
  currentFile: PanelEditorFile | null;
  drafts: DraftMap;
  includeKeys: boolean;
  manifest: PanelEditorManifest;
  query: string;
  selectedLanguages: string[];
  selectedStates: PanelEditorSearchStateFilter[];
}): WorkspaceSearchDisplayResult[] {
  const resultMap = new Map(apiResults.map(result => [searchResultIdentity(result), result as WorkspaceSearchDisplayResult]));
  if (!currentFile || drafts.size === 0) return [...resultMap.values()];

  const queryLower = query.toLocaleLowerCase();
  const languages = selectedLanguages.length > 0 ? selectedLanguages : manifest.languages;
  const stateSet = new Set(selectedStates);

  for (const row of currentFile.rows) {
    for (const lang of languages) {
      const identity = draftIdentity(lang, row.pointer);
      const draftValue = drafts.get(identity);
      if (draftValue === undefined) continue;
      resultMap.delete(`${currentFile.relativePath}\0${row.pointer}\0${lang}`);

      const cell = row.cells[lang];
      if (!cell || !cellMatchesStates(cell, isMasterLanguage(manifest, lang), stateSet)) continue;
      const valueMatchRanges = queryLower ? findMatchRanges(draftValue, queryLower) : [];
      const keyMatchRanges = includeKeys && queryLower ? findMatchRanges(row.displayPath, queryLower) : [];
      if (queryLower && valueMatchRanges.length === 0 && keyMatchRanges.length === 0) continue;
      resultMap.set(`${currentFile.relativePath}\0${row.pointer}\0${lang}`, {
        relativePath: currentFile.relativePath,
        pointer: row.pointer,
        segments: row.segments,
        displayPath: row.displayPath,
        lang,
        sourceLang: sourceLangForLanguage(manifest, lang),
        isMaster: isMasterLanguage(manifest, lang),
        value: draftValue,
        valueMatchRanges,
        keyMatchRanges,
        cell,
        draft: true,
      });
    }
  }

  return [...resultMap.values()].sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath)
    || left.displayPath.localeCompare(right.displayPath)
    || left.lang.localeCompare(right.lang)
  ));
}

function groupResultsByFile(results: WorkspaceSearchDisplayResult[]): Array<{
  relativePath: string;
  results: WorkspaceSearchDisplayResult[];
}> {
  const groups = new Map<string, WorkspaceSearchDisplayResult[]>();
  for (const result of results) {
    const group = groups.get(result.relativePath) || [];
    group.push(result);
    groups.set(result.relativePath, group);
  }
  return [...groups.entries()].map(([relativePath, groupResults]) => ({
    relativePath,
    results: groupResults,
  }));
}

function FilterCheckbox({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <label className="workspace-search-check">
      <Checkbox
        checked={checked}
        onCheckedChange={nextChecked => onCheckedChange(nextChecked === true)}
      />
      <span>{label}</span>
    </label>
  );
}

function Highlight({
  value,
  ranges,
}: {
  value: string;
  ranges: Array<{ start: number; end: number }>;
}) {
  if (ranges.length === 0) return <>{value}</>;
  const parts = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) parts.push(value.slice(cursor, range.start));
    parts.push(<mark key={`${range.start}:${range.end}`}>{value.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return <>{parts}</>;
}

function searchResultIdentity(result: PanelEditorSearchResult): string {
  return `${result.relativePath}\0${result.pointer}\0${result.lang}`;
}

function findMatchRanges(value: string, lowerQuery: string): Array<{ start: number; end: number }> {
  if (!lowerQuery) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  const lowerValue = value.toLocaleLowerCase();
  let start = lowerValue.indexOf(lowerQuery);
  while (start !== -1) {
    ranges.push({ start, end: start + lowerQuery.length });
    if (ranges.length >= 20) break;
    start = lowerValue.indexOf(lowerQuery, start + Math.max(lowerQuery.length, 1));
  }
  return ranges;
}

function cellMatchesStates(
  cell: PanelEditorSearchResult['cell'],
  isMaster: boolean,
  states: Set<PanelEditorSearchStateFilter>,
): boolean {
  if (states.size === 0) return true;
  return (
    (states.has('pending') && cell.pending)
    || (states.has('missing') && cell.kind === 'missing')
    || (states.has('skipped') && cell.skipped)
    || (states.has('master') && isMaster)
    || (states.has('target') && !isMaster)
  );
}

function isMasterLanguage(manifest: PanelEditorManifest, lang: string): boolean {
  return manifest.routes.some(route => route.sourceLang === lang);
}

function sourceLangForLanguage(manifest: PanelEditorManifest, lang: string): string {
  const sourceRoute = manifest.routes.find(route => route.sourceLang === lang);
  if (sourceRoute) return sourceRoute.sourceLang;
  return manifest.routes.find(route => route.languages.includes(lang))?.sourceLang || lang;
}
