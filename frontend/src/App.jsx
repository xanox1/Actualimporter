import { useMemo, useState } from 'react';

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

  const groups = useMemo(() => groupKeys(rows, groupByColumn), [rows, groupByColumn]);
  const mappedPreview = useMemo(() => applyMapping(rows.slice(0, 10), mapping), [rows, mapping]);

  function onCsvFileChange(event) {
    setCsvFile(event.target.files?.[0] || null);
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

    try {
      const formData = new FormData();
      formData.append('csv', csvFile);

      const response = await fetch('/api/csv/preview', {
        method: 'POST',
        body: formData
      });
      const payload = await response.json();

      if (!response.ok) {
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
    } catch (error) {
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
    setLoadingAccounts(true);
    setMessage('Rekeningen ophalen van Actual server...');

    try {
      const response = await fetch('/api/actual/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(actualConfig)
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || payload.details || 'Rekeningen ophalen mislukt.');
      }

      setAccounts(payload.accounts || []);
      setMessage(`Rekeningen geladen: ${(payload.accounts || []).length}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function loadBudgets() {
    setLoadingBudgets(true);
    setMessage('Budget IDs ophalen van Actual server...');

    try {
      const response = await fetch('/api/actual/budgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(actualConfig)
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || payload.details || 'Budget IDs ophalen mislukt.');
      }

      const nextBudgets = payload.budgets || [];
      setBudgets(nextBudgets);

      if (!actualConfig.budgetId && nextBudgets.length === 1) {
        setActualConfig((prev) => ({ ...prev, budgetId: nextBudgets[0].id }));
      }

      setMessage(`Budget IDs geladen: ${nextBudgets.length}`);
    } catch (error) {
      setMessage(error.message);
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
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || payload.details || 'Import mislukt.');
      }

      setImportResult(payload);
      setMessage(dryRun ? 'Dry-run afgerond.' : 'Import afgerond.');
    } catch (error) {
      setMessage(error.message);
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
        <h2>3) Actual accounts ophalen en koppelen</h2>
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
            Budget ID
            <input
              type="text"
              value={actualConfig.budgetId}
              onChange={(event) =>
                setActualConfig((prev) => ({ ...prev, budgetId: event.target.value }))
              }
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
            {loadingBudgets ? 'Bezig...' : 'Haal budget IDs op'}
          </button>
          <button type="button" onClick={loadAccounts} disabled={loadingAccounts}>
            {loadingAccounts ? 'Bezig...' : 'Haal accounts op'}
          </button>
        </div>

        {budgets.length > 0 && (
          <label>
            Beschikbare budget IDs
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
    </main>
  );
}