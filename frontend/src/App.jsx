import { useEffect, useMemo, useState } from 'react';

const TARGET_FIELDS = [
  { key: 'date', label: 'Datum' },
  { key: 'amount', label: 'Bedrag' },
  { key: 'payee', label: 'Tegenrekening / Payee' },
  { key: 'notes', label: 'Omschrijving / Notes' }
];

function getInitialRule(headers) {
  return {
    type: 'direct',
    column: headers[0] || '',
    columns: [],
    separator: ' '
  };
}

function applyMapping(rows, mapping) {
  return rows.map((row) => {
    const mapped = {};

    for (const field of TARGET_FIELDS) {
      const rule = mapping[field.key];
      if (!rule) {
        mapped[field.key] = '';
        continue;
      }

      if (rule.type === 'merge') {
        mapped[field.key] = (rule.columns || [])
          .map((column) => (row[column] ?? '').toString().trim())
          .filter(Boolean)
          .join(rule.separator ?? ' ');
      } else {
        mapped[field.key] = (row[rule.column] ?? '').toString().trim();
      }
    }

    return mapped;
  });
}

function groupKeys(rows, groupByColumn) {
  if (!groupByColumn) {
    return ['all'];
  }

  const keys = new Set();
  for (const row of rows) {
    const key = (row[groupByColumn] ?? '').toString().trim() || '(leeg)';
    keys.add(key);
  }
  return [...keys];
}

function parseApiMessage(payload, fallbackError, fallbackHint) {
  const lines = [];

  if (payload?.error) {
    lines.push(payload.error);
  } else if (fallbackError) {
    lines.push(fallbackError);
  }

  if (payload?.details) {
    lines.push(`Details: ${payload.details}`);
  }

  if (payload?.hint || fallbackHint) {
    lines.push(`Tip: ${payload?.hint || fallbackHint}`);
  }

  return lines.filter(Boolean).join('\n');
}

function stringifyDebugValue(value) {
  if (value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

export default function App() {
  const [csvFile, setCsvFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState({});
  const [groupByColumn, setGroupByColumn] = useState('');
  const [accountMapping, setAccountMapping] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [actualConfig, setActualConfig] = useState({
    serverUrl: '',
    password: '',
    budgetId: ''
  });
  const [dryRun, setDryRun] = useState(true);
  const [message, setMessage] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingBudgets, setLoadingBudgets] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [lastApiError, setLastApiError] = useState(null);
  const [copyDebugStatus, setCopyDebugStatus] = useState('');
  const canLoadAccounts =
    Boolean(actualConfig.serverUrl.trim()) &&
    Boolean(actualConfig.password) &&
    Boolean(actualConfig.budgetId.trim());

  const groups = useMemo(() => groupKeys(rows, groupByColumn), [rows, groupByColumn]);
  const mappedPreview = useMemo(() => applyMapping(rows.slice(0, 10), mapping), [rows, mapping]);

  useEffect(() => {
    setCopyDebugStatus('');
  }, [lastApiError]);

  function onCsvFileChange(event) {
    setCsvFile(event.target.files?.[0] || null);
  }

  async function copyTextToClipboard(text) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      setCopyDebugStatus('Details gekopieerd naar klembord.');
      return true;
    } catch (_error) {
      setCopyDebugStatus('Kopiëren mislukt. Kopieer de tekst handmatig uit dit paneel.');
      return false;
    }
  }

  function debugAsText() {
    if (!lastApiError) {
      return '';
    }

    const lines = [
      `Actie: ${lastApiError.action || '-'}`,
      `Endpoint: ${lastApiError.endpoint || '-'}`,
      `Status: ${lastApiError.status || '-'} ${lastApiError.statusText || ''}`.trim()
    ];

    if (lastApiError.reason) {
      lines.push(`Reden: ${lastApiError.reason}`);
    }

    if (lastApiError.networkError) {
      lines.push(`Netwerkfout: ${lastApiError.networkError}`);
    }

    if (lastApiError.responsePayload !== undefined) {
      lines.push('Response payload:');
      lines.push(stringifyDebugValue(lastApiError.responsePayload));
    }

    return lines.join('\n');
  }

  async function copyDebugAsText() {
    if (!lastApiError) {
      return;
    }

    const text = debugAsText();
    await copyTextToClipboard(text);
  }

  async function copyDebugAsJson() {
    if (!lastApiError) {
      return;
    }

    const json = stringifyDebugValue(lastApiError);
    await copyTextToClipboard(json);
  }

  async function uploadCsv(event) {
    event.preventDefault();
    if (!csvFile) {
      setMessage('Selecteer eerst een CSV-bestand.');
      return;
    }

    setLoadingPreview(true);
    setMessage('CSV wordt geanalyseerd...');
    setImportResult(null);
    setLastApiError(null);

    try {
      const formData = new FormData();
      formData.append('csv', csvFile);

      const response = await fetch('/api/csv/preview', {
        method: 'POST',
        body: formData
      });
      const payload = await response.json();

      if (!response.ok) {
        setLastApiError({
          action: 'csv-preview',
          endpoint: '/api/csv/preview',
          status: response.status,
          statusText: response.statusText,
          responsePayload: payload
        });
        throw new Error(payload.error || 'CSV upload mislukt.');
      }

      setHeaders(payload.headers || []);
      setRows(payload.rows || []);
      setRowCount(payload.rowCount || 0);

      const nextMapping = {};
      for (const field of TARGET_FIELDS) {
        nextMapping[field.key] = getInitialRule(payload.headers || []);
      }
      setMapping(nextMapping);

      setMessage(`CSV geladen: ${payload.rowCount || 0} rijen, delimiter '${payload.delimiter}'.`);
      setLastApiError(null);
    } catch (error) {
      if (!lastApiError) {
        setLastApiError({
          action: 'csv-preview',
          endpoint: '/api/csv/preview',
          networkError: error.message
        });
      }
      setMessage(error.message);
    } finally {
      setLoadingPreview(false);
    }
  }

  function updateRule(fieldKey, patch) {
    setMapping((prev) => ({
      ...prev,
      [fieldKey]: {
        ...(prev[fieldKey] || getInitialRule(headers)),
        ...patch
      }
    }));
  }

  async function loadAccounts() {
    if (!actualConfig.serverUrl.trim()) {
      setMessage('ACTUAL_SERVER_URL ontbreekt.\nTip: Vul de server URL in bij stap 3.');
      return;
    }

    if (!actualConfig.password) {
      setMessage('ACTUAL_PASSWORD ontbreekt.\nTip: Vul het wachtwoord in bij stap 3.');
      return;
    }

    if (!actualConfig.budgetId.trim()) {
      setMessage('ACTUAL_BUDGET_ID ontbreekt.\nTip: Haal eerst budget IDs op en kies een budget.');
      return;
    }

    setLoadingAccounts(true);
    setMessage('Rekeningen ophalen van Actual server...');
    setLastApiError(null);

    try {
      const response = await fetch('/api/actual/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(actualConfig)
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setLastApiError({
          action: 'load-accounts',
          endpoint: '/api/actual/accounts',
          status: response.status,
          statusText: response.statusText,
          responsePayload: payload
        });
        setMessage(
          parseApiMessage(
            payload,
            'Rekeningen ophalen mislukt.',
            'Controleer server URL, wachtwoord en budget ID.'
          )
        );
        return;
      }

      setAccounts(payload.accounts || []);
      setMessage(`Rekeningen geladen: ${(payload.accounts || []).length}`);
      setLastApiError(null);
    } catch (error) {
      setLastApiError({
        action: 'load-accounts',
        endpoint: '/api/actual/accounts',
        networkError: error.message
      });
      setMessage(
        parseApiMessage(
          null,
          `Netwerkfout tijdens rekeningen ophalen: ${error.message}`,
          'Controleer of de backend draait en dat de server URL bereikbaar is.'
        )
      );
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function loadBudgets() {
    if (!actualConfig.serverUrl.trim()) {
      setMessage('ACTUAL_SERVER_URL ontbreekt.\nTip: Vul de server URL in bij stap 3.');
      return;
    }

    if (!actualConfig.password) {
      setMessage('ACTUAL_PASSWORD ontbreekt.\nTip: Vul het wachtwoord in bij stap 3.');
      return;
    }

    setLoadingBudgets(true);
    setMessage('Budget IDs ophalen van Actual server...');
    setLastApiError(null);

    try {
      const response = await fetch('/api/actual/budgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(actualConfig)
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setLastApiError({
          action: 'load-budgets',
          endpoint: '/api/actual/budgets',
          status: response.status,
          statusText: response.statusText,
          responsePayload: payload
        });
        setMessage(
          parseApiMessage(
            payload,
            'Budget IDs ophalen mislukt.',
            'Controleer server URL/wachtwoord en of /api/budgets beschikbaar is.'
          )
        );
        return;
      }

      const nextBudgets = payload.budgets || [];
      setBudgets(nextBudgets);

      if (!actualConfig.budgetId && nextBudgets.length === 1) {
        setActualConfig((prev) => ({ ...prev, budgetId: nextBudgets[0].id }));
        setMessage(`1 budget ID geladen en automatisch geselecteerd: ${nextBudgets[0].id}`);
        return;
      }

      if (!nextBudgets.length) {
        setLastApiError({
          action: 'load-budgets',
          endpoint: '/api/actual/budgets',
          status: response.status,
          statusText: response.statusText,
          responsePayload: payload,
          reason: 'No budgets returned'
        });
        setMessage(
          'Geen budget IDs ontvangen van de API.\nTip: Controleer of dit account toegang heeft tot budgetten.'
        );
        return;
      }

      setMessage(`Budget IDs geladen: ${nextBudgets.length}. Kies er één en haal daarna accounts op.`);
      setLastApiError(null);
    } catch (error) {
      setLastApiError({
        action: 'load-budgets',
        endpoint: '/api/actual/budgets',
        networkError: error.message
      });
      setMessage(
        parseApiMessage(
          null,
          `Netwerkfout tijdens budget IDs ophalen: ${error.message}`,
          'Controleer of de backend draait en dat de server URL bereikbaar is.'
        )
      );
    } finally {
      setLoadingBudgets(false);
    }
  }

  async function runImport() {
    if (!rows.length) {
      setMessage('Upload eerst CSV data.');
      return;
    }

    setLoadingImport(true);
    setMessage(dryRun ? 'Dry-run validatie gestart...' : 'Import gestart...');
    setLastApiError(null);

    try {
      const response = await fetch('/api/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rows,
          mapping,
          groupByColumn,
          accountMapping,
          dryRun,
          actualConfig
        })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setLastApiError({
          action: 'run-import',
          endpoint: '/api/import',
          status: response.status,
          statusText: response.statusText,
          responsePayload: payload
        });
        setMessage(
          parseApiMessage(
            payload,
            'Import mislukt.',
            'Controleer mapping, account-koppeling en Actual configuratie.'
          )
        );
        return;
      }

      setImportResult(payload);
      setMessage(dryRun ? 'Dry-run afgerond.' : 'Import afgerond.');
      setLastApiError(null);
    } catch (error) {
      setLastApiError({
        action: 'run-import',
        endpoint: '/api/import',
        networkError: error.message
      });
      setMessage(
        parseApiMessage(
          null,
          `Netwerkfout tijdens import: ${error.message}`,
          'Controleer of de backend draait en probeer opnieuw.'
        )
      );
    } finally {
      setLoadingImport(false);
    }
  }

  return (
    <main className="container">
      <h1>Actualimporter</h1>
      <p className="subtitle">Rabobank CSV naar Actual Budget (web + API)</p>

      <section className="card">
        <h2>1) CSV upload & inspectie</h2>
        <form className="row" onSubmit={uploadCsv}>
          <input type="file" accept=".csv,text/csv" onChange={onCsvFileChange} />
          <button type="submit" disabled={loadingPreview}>
            {loadingPreview ? 'Bezig...' : 'Upload CSV'}
          </button>
        </form>
        <p className="info">Ingelezen rijen: {rowCount}</p>

        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 15).map((row, index) => (
                  <tr key={index}>
                    {headers.map((header) => (
                      <td key={`${index}-${header}`}>{row[header]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>2) Kolommen toewijzen / samenvoegen</h2>
        {!headers.length && <p className="info">Upload eerst CSV om mapping in te stellen.</p>}

        {TARGET_FIELDS.map((field) => {
          const rule = mapping[field.key] || getInitialRule(headers);
          return (
            <div key={field.key} className="mapping-row">
              <div>
                <strong>{field.label}</strong>
              </div>
              <select
                value={rule.type}
                onChange={(event) =>
                  updateRule(field.key, {
                    type: event.target.value,
                    column: headers[0] || '',
                    columns: [],
                    separator: ' '
                  })
                }
              >
                <option value="direct">Directe kolom</option>
                <option value="merge">Samenvoegen</option>
              </select>

              {rule.type === 'direct' ? (
                <select
                  value={rule.column || ''}
                  onChange={(event) => updateRule(field.key, { column: event.target.value })}
                >
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="merge-box">
                  <label>Scheidingsteken</label>
                  <input
                    type="text"
                    value={rule.separator ?? ' '}
                    onChange={(event) => updateRule(field.key, { separator: event.target.value })}
                  />
                  <div className="checkbox-grid">
                    {headers.map((header) => (
                      <label key={`${field.key}-${header}`}>
                        <input
                          type="checkbox"
                          checked={(rule.columns || []).includes(header)}
                          onChange={(event) => {
                            const next = new Set(rule.columns || []);
                            if (event.target.checked) {
                              next.add(header);
                            } else {
                              next.delete(header);
                            }
                            updateRule(field.key, { columns: [...next] });
                          }}
                        />
                        {header}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {mappedPreview.length > 0 && (
          <>
            <h3>Voorbeeld na mapping</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {TARGET_FIELDS.map((field) => (
                      <th key={field.key}>{field.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedPreview.map((row, index) => (
                    <tr key={`mapped-${index}`}>
                      {TARGET_FIELDS.map((field) => (
                        <td key={`${index}-${field.key}`}>{row[field.key]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>3) Actual budget en accounts koppelen</h2>
        <div className="grid3">
          <label>
            Actual server URL
            <input
              type="text"
              value={actualConfig.serverUrl}
              onChange={(event) =>
                setActualConfig((prev) => ({ ...prev, serverUrl: event.target.value }))
              }
              placeholder="https://actual.example.com"
            />
          </label>
          <label>
            Wachtwoord
            <input
              type="password"
              value={actualConfig.password}
              onChange={(event) =>
                setActualConfig((prev) => ({ ...prev, password: event.target.value }))
              }
            />
          </label>
        </div>

        <div className="row">
          <button type="button" onClick={loadBudgets} disabled={loadingBudgets}>
            {loadingBudgets ? 'Bezig...' : '1) Haal budget IDs op'}
          </button>
        </div>

        {budgets.length > 0 && (
          <label>
            2) Kies budget ID
            <select
              value={actualConfig.budgetId}
              onChange={(event) =>
                setActualConfig((prev) => ({ ...prev, budgetId: event.target.value }))
              }
            >
              <option value="">-- Kies budget --</option>
              {budgets.map((budget) => (
                <option key={budget.id} value={budget.id}>
                  {budget.name} ({budget.id})
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Of vul Budget ID handmatig in
          <input
            type="text"
            value={actualConfig.budgetId}
            onChange={(event) =>
              setActualConfig((prev) => ({ ...prev, budgetId: event.target.value }))
            }
          />
        </label>

        <div className="row">
          <button type="button" onClick={loadAccounts} disabled={loadingAccounts || !canLoadAccounts}>
            {loadingAccounts ? 'Bezig...' : '3) Haal accounts op'}
          </button>
        </div>

        {!canLoadAccounts && (
          <p className="info">
            Vul server URL en wachtwoord in, haal budget IDs op en kies een budget (of vul handmatig in).
          </p>
        )}

        {groups.length > 0 && (
          <div className="group-mapping">
            <h3>Groep → Account mapping</h3>
            <label>
              Groepeer op kolom
              <select value={groupByColumn} onChange={(event) => setGroupByColumn(event.target.value)}>
                <option value="">Alles in één account</option>
                {headers.map((header) => (
                  <option key={`group-${header}`} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </label>

            {groups.map((group) => (
              <div key={`map-${group}`} className="mapping-row">
                <strong>{group}</strong>
                <select
                  value={accountMapping[group] || ''}
                  onChange={(event) =>
                    setAccountMapping((prev) => ({
                      ...prev,
                      [group]: event.target.value
                    }))
                  }
                >
                  <option value="">-- Kies account --</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>4) Dry-run / import</h2>
        <label className="row">
          <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
          Dry-run (alleen valideren, niet posten naar Actual)
        </label>
        <button type="button" onClick={runImport} disabled={loadingImport}>
          {loadingImport ? 'Bezig...' : dryRun ? 'Start dry-run' : 'Start import'}
        </button>

        {importResult && (
          <div className="result">
            <p>Totaal transacties: {importResult.totalTransactions}</p>
            <p>Ongeldige transacties: {importResult.totalInvalid}</p>
            <ul>
              {(importResult.groups || []).map((group) => (
                <li key={`result-${group.group}`}>
                  groep <strong>{group.group}</strong>: {group.transactionCount} transacties, {group.invalidCount}{' '}
                  ongeldig
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {message && <p className="status">{message}</p>}
      {lastApiError && (
        <details className="debug-panel">
          <summary>Toon technische foutdetails</summary>
          <div className="row debug-actions">
            <button type="button" onClick={copyDebugAsText}>
              Kopieer als tekst
            </button>
            <button type="button" onClick={copyDebugAsJson}>
              Kopieer als JSON
            </button>
            {copyDebugStatus && <span className="info">{copyDebugStatus}</span>}
          </div>
          <pre>{stringifyDebugValue(lastApiError)}</pre>
        </details>
      )}
    </main>
  );
}