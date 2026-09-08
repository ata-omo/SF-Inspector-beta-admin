/* global React ReactDOM */
/* global initButton */

import {sfConn, apiVersion} from "./inspector.js";
import {csvParse} from "./csv-parse.js";
import {copyToClipboard} from "./data-load.js";

const h = React.createElement;

const STATUS = Object.freeze({ QUEUED: "Queued", PROCESSING: "Processing", SUCCEEDED: "Succeeded", FAILED: "Failed" });

const STANDARD_HEADERS = Object.freeze({
  EMPLOYEE: ["employee id", "employee number", "employeenumber", "employee"],
  MANAGER: ["manager id", "manager employee id", "manager employee number", "manageremployeenumber", "manager"]
});

class Model {
  constructor(sfHost) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;

    this.userInfo = "...";

    this.rows = [];
    this.dataError = "";
    this.generalMessage = "";

    this.batchSize = "50";
    this.threadCount = "2";

    this.activeBatches = 0;
    this.isProcessingQueue = false;
    this.cancelRequested = false;

    this.spinnerCount = 0;

    this.confirmPopup = null;

    this.reactCallback = null;
    this.testCallback = null;

    this.showStatus = {Queued: true, Processing: true, Succeeded: true, Failed: true};

    this.loadUserInfo();
  }

  didUpdate(cb) { if (this.reactCallback) this.reactCallback(cb); if (this.testCallback) this.testCallback(); }

  spinFor(promise) { this.spinnerCount++; this.didUpdate(); return promise.catch(err => { console.error("Manager Update operation failed", err); throw err; }).finally(() => { this.spinnerCount--; this.didUpdate(); }); }

  loadUserInfo() {
    const request = sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {});
    this.spinFor(request)
      .then(result => { this.userInfo = [result.userFullName, result.userName, result.organizationName].filter(Boolean).join(" / "); this.didUpdate(); })
      .catch(err => { this.userInfo = "Unable to load Salesforce user information"; console.error("Unable to retrieve Salesforce user information", err); this.didUpdate(); });
  }

  isWorking() { return this.isProcessingQueue || this.activeBatches > 0; }

  normalizeHeader(value) { return String(value == null ? "" : value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "); }

  findHeaderIndex(headers, acceptedHeaders) { const normAccepted = acceptedHeaders.map(h => this.normalizeHeader(h)); return headers.findIndex(header => normAccepted.includes(this.normalizeHeader(header))); }

  getSeparator(text) { const first = String(text || "").split(/\r?\n/)[0] || ""; if (first.includes("\t")) return "\t"; return ","; }

  setData(text) {
    if (this.isWorking()) return;
    this.rows = []; this.dataError = ""; this.generalMessage = ""; this.confirmPopup = null; this.cancelRequested = false;
    if (!text || !text.trim()) { this.dataError = "No data was pasted."; this.didUpdate(); return; }
    const separator = this.getSeparator(text);
    let parsed;
    try { parsed = csvParse(text, separator); } catch (e) { this.dataError = "Unable to read the pasted data: " + (e.message || String(e)); this.didUpdate(); return; }
    if (!Array.isArray(parsed) || parsed.length < 2) { this.dataError = "Paste a header row and at least one data row."; this.didUpdate(); return; }
    const headers = parsed.shift(); if (!Array.isArray(headers)) { this.dataError = "The pasted header row is invalid."; this.didUpdate(); return; }
    const employeeColumnIndex = this.findHeaderIndex(headers, STANDARD_HEADERS.EMPLOYEE);
    const managerColumnIndex = this.findHeaderIndex(headers, STANDARD_HEADERS.MANAGER);
    if (employeeColumnIndex === -1) { this.dataError = "Employee ID column was not found. Use a header such as 'Employee ID' or 'Employee Number'."; this.didUpdate(); return; }
    if (managerColumnIndex === -1) { this.dataError = "Manager ID column was not found. Use a header such as 'Manager ID' or 'Manager Employee Number'."; this.didUpdate(); return; }
    if (employeeColumnIndex === managerColumnIndex) { this.dataError = "Employee ID and Manager ID must be separate columns."; this.didUpdate(); return; }
    const dataRows = parsed.filter(row => Array.isArray(row) && row.some(cell => String(cell == null ? "" : cell).trim() !== ""));
    const encountered = new Set(); const duplicates = new Set();
    for (const row of dataRows) { const emp = String(row[employeeColumnIndex] == null ? "" : row[employeeColumnIndex]).trim(); if (!emp) continue; if (encountered.has(emp)) duplicates.add(emp); else encountered.add(emp); }
    this.rows = dataRows.map((row, idx) => {
      const employeeNumber = String(row[employeeColumnIndex] == null ? "" : row[employeeColumnIndex]).trim();
      const managerEmployeeNumber = String(row[managerColumnIndex] == null ? "" : row[managerColumnIndex]).trim();
      let validationError = "";
      if (!employeeNumber) validationError = "Employee ID is blank.";
      else if (!managerEmployeeNumber) validationError = "Manager ID is blank.";
      else if (employeeNumber === managerEmployeeNumber) validationError = "Employee ID and Manager ID cannot be the same.";
      else if (duplicates.has(employeeNumber)) validationError = "Duplicate Employee ID exists in the pasted data.";
      return { rowNumber: idx + 2, employeeNumber, employeeName: "", employeeSalesforceId: "", managerEmployeeNumber, managerName: "", managerSalesforceId: "", currentManagerEmployeeNumber: "", currentManagerName: "", currentManagerSalesforceId: "", status: validationError ? STATUS.FAILED : STATUS.QUEUED, action: "", error: validationError };
    });
    if (this.rows.length === 0) { this.dataError = "No data rows were found."; this.didUpdate(); return; }
    const counts = this.counts(); this.generalMessage = this.rows.length + " row" + (this.rows.length === 1 ? "" : "s") + " parsed. " + counts.Queued + " queued and " + counts.Failed + " failed initial validation.";
    this.didUpdate();
  }

  clearData() { if (this.isWorking()) return; this.rows = []; this.dataError = ""; this.generalMessage = ""; this.confirmPopup = null; this.cancelRequested = false; this.didUpdate(); }

  counts() { const counts = {Queued:0, Processing:0, Succeeded:0, Failed:0}; for (const r of this.rows) if (Object.prototype.hasOwnProperty.call(counts, r.status)) counts[r.status]++; return counts; }

  visibleRows() { return this.rows.filter(r => this.showStatus[r.status] !== false); }

  batchSizeError() { const n = Number(this.batchSize); if (!Number.isInteger(n) || n < 1) return "Batch size must be a positive whole number."; if (n > 200) return "Batch size cannot be greater than 200."; return ""; }

  threadCountError() { const n = Number(this.threadCount); if (!Number.isInteger(n) || n < 1) return "Threads must be a positive whole number."; if (n > 6) return "Threads cannot be greater than 6."; return ""; }

  canRun() { return !this.isWorking() && !this.batchSizeError() && !this.threadCountError() && this.rows.some(r => r.status === STATUS.QUEUED); }

  requestRunUpdate() { if (!this.canRun()) return; const queuedCount = this.counts().Queued; this.confirmPopup = { title: "Confirm Manager Update", text: queuedCount + " user" + (queuedCount === 1 ? "" : "s") + " will be processed. The Manager field on matching Salesforce User records will be updated." }; this.didUpdate(); }

  cancelConfirmation() { this.confirmPopup = null; this.didUpdate(); }
  confirmRunUpdate() { if (!this.confirmPopup || !this.canRun()) { this.confirmPopup = null; this.didUpdate(); return; } this.confirmPopup = null; this.runUpdate(); }

  escapeSoqlValue(value) { return String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

  chunkArray(values, chunkSize) { const chunks = []; for (let i=0;i<values.length;i+=chunkSize) chunks.push(values.slice(i,i+chunkSize)); return chunks; }

  async queryAll(soql) { const firstUrl = "/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(soql); const all = []; let result = await sfConn.rest(firstUrl); if (result && Array.isArray(result.records)) all.push(...result.records); while (result && result.done === false && result.nextRecordsUrl) { result = await sfConn.rest(result.nextRecordsUrl); if (result && Array.isArray(result.records)) all.push(...result.records); } return all; }

  async resolveUsers() {
    const queuedRows = this.rows.filter(r => r.status === STATUS.QUEUED);
    if (queuedRows.length === 0) return;
    const unique = new Set(); for (const r of queuedRows) { unique.add(r.employeeNumber); unique.add(r.managerEmployeeNumber); }
    const numbers = Array.from(unique);
    const queryChunks = this.chunkArray(numbers, 150);
    const userRecords = [];
    for (const chunk of queryChunks) {
      if (this.cancelRequested) return;
      const inClause = chunk.map(v => "'" + this.escapeSoqlValue(v) + "'").join(",");
      const soql = "SELECT Id, Name, EmployeeNumber, ManagerId, Manager.Name, Manager.EmployeeNumber FROM User WHERE EmployeeNumber IN (" + inClause + ")";
      const recs = await this.queryAll(soql);
      userRecords.push(...recs);
    }
    const usersByEmployeeNumber = new Map();
    for (const u of userRecords) { const emp = String(u.EmployeeNumber == null ? "" : u.EmployeeNumber).trim(); if (!emp) continue; if (!usersByEmployeeNumber.has(emp)) usersByEmployeeNumber.set(emp, []); usersByEmployeeNumber.get(emp).push(u); }
    for (const row of queuedRows) {
      if (this.cancelRequested) return;
      const employeeMatches = usersByEmployeeNumber.get(row.employeeNumber) || [];
      const managerMatches = usersByEmployeeNumber.get(row.managerEmployeeNumber) || [];
      if (employeeMatches.length === 0) { this.failRow(row, "Employee ID was not found in Salesforce."); continue; }
      if (employeeMatches.length > 1) { this.failRow(row, "Multiple Salesforce Users have this Employee ID."); continue; }
      if (managerMatches.length === 0) { this.failRow(row, "Manager ID was not found in Salesforce."); continue; }
      if (managerMatches.length > 1) { this.failRow(row, "Multiple Salesforce Users have this Manager ID."); continue; }
      const employee = employeeMatches[0]; const manager = managerMatches[0];
      if (!employee.Id) { this.failRow(row, "Employee Salesforce User ID is missing."); continue; }
      if (!manager.Id) { this.failRow(row, "Manager Salesforce User ID is missing."); continue; }
      if (employee.Id === manager.Id) { this.failRow(row, "Employee and manager resolve to the same Salesforce User."); continue; }
      row.employeeSalesforceId = employee.Id; row.employeeName = employee.Name || ""; row.managerSalesforceId = manager.Id; row.managerName = manager.Name || "";
      row.currentManagerSalesforceId = employee.ManagerId || ""; row.currentManagerName = employee.Manager ? (employee.Manager.Name || "") : ""; row.currentManagerEmployeeNumber = employee.Manager ? (employee.Manager.EmployeeNumber || "") : "";
      if (employee.ManagerId && employee.ManagerId === manager.Id) { row.status = STATUS.SUCCEEDED; row.action = "No Change Required"; row.error = "The requested manager is already assigned."; }
    }
  }

  failRow(row, message) { row.status = STATUS.FAILED; row.action = ""; row.error = message; }

  async runUpdate() {
    if (!this.canRun()) return;
    this.isProcessingQueue = true; this.cancelRequested = false; this.dataError = ""; this.generalMessage = "Looking up employees and managers in Salesforce..."; this.didUpdate();
    try {
      await this.resolveUsers();
      if (this.cancelRequested) { this.isProcessingQueue = false; this.generalMessage = "Queued processing was cancelled."; this.didUpdate(); return; }
      const queuedRows = this.rows.filter(r => r.status === STATUS.QUEUED);
      if (queuedRows.length === 0) { this.isProcessingQueue = false; this.generalMessage = "No rows to process."; this.didUpdate(); return; }
      const batchSize = Math.max(1, Number(this.batchSize) || 50);
      const threadCount = Math.max(1, Math.min(6, Number(this.threadCount) || 1));
      const batches = this.chunkArray(queuedRows, batchSize);
      const wsdl = sfConn.wsdl(apiVersion, "Enterprise");

      const processBatch = async (batchRows) => {
        if (this.cancelRequested) return;
        for (const row of batchRows) { row.status = STATUS.PROCESSING; row.action = "Updating"; row.error = ""; }
        this.activeBatches++; this.didUpdate();
        const sObjects = batchRows.map(row => ({"$xsi:type": "sf:User", Id: row.employeeSalesforceId, ManagerId: row.managerSalesforceId}));
        try {
          const res = await this.spinFor(sfConn.soap(wsdl, "update", { sObjects }));
          const results = sfConn.asArray(res);
          for (let i = 0; i < results.length; i++) { const r = results[i]; const row = batchRows[i]; if (r && String(r.success) === "true") { row.status = STATUS.SUCCEEDED; row.action = "Updated"; row.error = ""; } else { row.status = STATUS.FAILED; row.action = ""; const errors = sfConn.asArray(r && r.errors); row.error = errors.map(e => (e.statusCode ? e.statusCode + ": " : "") + (e.message || JSON.stringify(e))).join(", "); } }
        } catch (err) { const msg = err && err.message ? err.message : String(err); for (const row of batchRows) { row.status = STATUS.FAILED; row.action = ""; row.error = msg; } } finally { this.activeBatches--; this.didUpdate(); }
      };

      const workers = [];
      for (let i = 0; i < threadCount; i++) {
        workers.push((async () => { while (!this.cancelRequested) { const batch = batches.shift(); if (!batch) break; await processBatch(batch); } })());
      }

      await Promise.all(workers);

      if (this.cancelRequested) this.generalMessage = "Queued processing was cancelled."; else { const counts = this.counts(); this.generalMessage = counts.Succeeded + " succeeded, " + counts.Failed + " failed."; }
    } catch (error) { this.dataError = "An unexpected error occurred while processing the queue."; console.error("Manager Update runUpdate failed", error); }
    finally { this.isProcessingQueue = false; this.didUpdate(); }
  }
}

class App extends React.Component {
  constructor(props) { super(props); this.onLoadClick = this.onLoadClick.bind(this); this.onClearClick = this.onClearClick.bind(this); this.onRunClick = this.onRunClick.bind(this); this.onCancelClick = this.onCancelClick.bind(this); this.onConfirmYes = this.onConfirmYes.bind(this); this.onConfirmNo = this.onConfirmNo.bind(this); }
  onLoadClick(e) { e.preventDefault(); const ta = document.getElementById("manager-input"); if (ta) this.props.model.setData(ta.value); }
  onClearClick(e) { e.preventDefault(); this.props.model.clearData(); }
  onRunClick(e) { e.preventDefault(); this.props.model.requestRunUpdate(); }
  onCancelClick(e) { e.preventDefault(); this.props.model.cancelRequested = true; this.props.model.didUpdate(); }
  onConfirmYes() { this.props.model.confirmRunUpdate(); }
  onConfirmNo() { this.props.model.cancelConfirmation(); }
  render() {
    const model = this.props.model;
    return h("div", {className: "main"},
      h("div", {className: "result-bar"}, h("h1", {}, "Manager Update"), h("div", {}, model.userInfo)),
      h("div", {className: "area"}, h("textarea", {id: "manager-input", placeholder: "Paste CSV or Excel data here", rows: 8}), h("div", {className: "button-group"}, h("button", {onClick: this.onLoadClick, disabled: model.isWorking()}, "Load Data"), h("button", {onClick: this.onClearClick, disabled: model.isWorking()}, "Clear"), h("button", {onClick: this.onRunClick, disabled: !model.canRun()}, "Run Update"), h("button", {onClick: this.onCancelClick, disabled: !model.isWorking()}, "Cancel")), model.dataError ? h("div", {className: "error"}, model.dataError) : null, h("div", {className: "message"}, model.generalMessage)),
      h("div", {className: "area result-area"}, h("table", {className: "result-table"}, h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Employee"), h("th", {}, "Manager"), h("th", {}, "Status"), h("th", {}, "Action"), h("th", {}, "Error"))), h("tbody", {}, model.visibleRows().map(row => h("tr", {key: row.rowNumber}, h("td", {}, row.rowNumber), h("td", {}, row.employeeNumber + (row.employeeName ? " - " + row.employeeName : "")), h("td", {}, row.managerEmployeeNumber + (row.managerName ? " - " + row.managerName : "")), h("td", {}, row.status), h("td", {}, row.action), h("td", {}, row.error)) )), model.confirmPopup ? h("div", {}, h("div", {id: "confirm-background"}, h("div", {id: "confirm-dialog"}, h("h1", {}, model.confirmPopup.title), h("p", {}, model.confirmPopup.text), h("div", {className: "dialog-buttons"}, h("button", {onClick: this.onConfirmYes}, "Yes"), h("button", {onClick: this.onConfirmNo, className: "cancel-btn"}, "Cancel") ) ) ) ) : null )
    );
  }
}

// Mount
{
  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {
    let root = document.getElementById("root");
    let model = new Model(sfHost);
    model.reactCallback = cb => { ReactDOM.render(h(App, {model}), root, cb); };
    ReactDOM.render(h(App, {model}), root);
    if (parent && parent.isUnitTest) parent.insextTestLoaded({model});
  });
}
/* global React ReactDOM */
/* global initButton */

import {sfConn, apiVersion} from "./inspector.js";
import {csvParse} from "./csv-parse.js";
import {copyToClipboard} from "./data-load.js";

const h = React.createElement;

const STATUS = Object.freeze({ QUEUED: "Queued", PROCESSING: "Processing", SUCCEEDED: "Succeeded", FAILED: "Failed" });

const STANDARD_HEADERS = Object.freeze({
  EMPLOYEE: ["employee id", "employee number", "employeenumber", "employee"],
  MANAGER: ["manager id", "manager employee id", "manager employee number", "manageremployeenumber", "manager"]
});

class Model {
  constructor(sfHost) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;

    this.userInfo = "...";

    this.rows = [];
    this.dataError = "";
    this.generalMessage = "";

    this.batchSize = "50";
    this.threadCount = "2";

    this.activeBatches = 0;
    this.isProcessingQueue = false;
    this.cancelRequested = false;

    this.spinnerCount = 0;

    this.confirmPopup = null;

    this.reactCallback = null;
    this.testCallback = null;

    this.showStatus = {Queued: true, Processing: true, Succeeded: true, Failed: true};

    this.loadUserInfo();
  }

  didUpdate(cb) { if (this.reactCallback) this.reactCallback(cb); if (this.testCallback) this.testCallback(); }

  spinFor(promise) { this.spinnerCount++; this.didUpdate(); return promise.catch(err => { console.error("Manager Update operation failed", err); throw err; }).finally(() => { this.spinnerCount--; this.didUpdate(); }); }

  loadUserInfo() {
    const request = sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {});
    this.spinFor(request)
      .then(result => { this.userInfo = [result.userFullName, result.userName, result.organizationName].filter(Boolean).join(" / "); this.didUpdate(); })
      .catch(err => { this.userInfo = "Unable to load Salesforce user information"; console.error("Unable to retrieve Salesforce user information", err); this.didUpdate(); });
  }

  isWorking() { return this.isProcessingQueue || this.activeBatches > 0; }

  normalizeHeader(value) { return String(value == null ? "" : value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "); }

  findHeaderIndex(headers, acceptedHeaders) { const normAccepted = acceptedHeaders.map(h => this.normalizeHeader(h)); return headers.findIndex(header => normAccepted.includes(this.normalizeHeader(header))); }

  getSeparator(text) { const first = String(text || "").split(/\r?\n/)[0] || ""; if (first.includes("\t")) return "\t"; return ","; }

  setData(text) {
    if (this.isWorking()) return;
    this.rows = []; this.dataError = ""; this.generalMessage = ""; this.confirmPopup = null; this.cancelRequested = false;
    if (!text || !text.trim()) { this.dataError = "No data was pasted."; this.didUpdate(); return; }
    const separator = this.getSeparator(text);
    let parsed;
    try { parsed = csvParse(text, separator); } catch (e) { this.dataError = "Unable to read the pasted data: " + (e.message || String(e)); this.didUpdate(); return; }
    if (!Array.isArray(parsed) || parsed.length < 2) { this.dataError = "Paste a header row and at least one data row."; this.didUpdate(); return; }
    const headers = parsed.shift(); if (!Array.isArray(headers)) { this.dataError = "The pasted header row is invalid."; this.didUpdate(); return; }
    const employeeColumnIndex = this.findHeaderIndex(headers, STANDARD_HEADERS.EMPLOYEE);
    const managerColumnIndex = this.findHeaderIndex(headers, STANDARD_HEADERS.MANAGER);
    if (employeeColumnIndex === -1) { this.dataError = "Employee ID column was not found. Use a header such as 'Employee ID' or 'Employee Number'."; this.didUpdate(); return; }
    if (managerColumnIndex === -1) { this.dataError = "Manager ID column was not found. Use a header such as 'Manager ID' or 'Manager Employee Number'."; this.didUpdate(); return; }
    if (employeeColumnIndex === managerColumnIndex) { this.dataError = "Employee ID and Manager ID must be separate columns."; this.didUpdate(); return; }
    const dataRows = parsed.filter(row => Array.isArray(row) && row.some(cell => String(cell == null ? "" : cell).trim() !== ""));
    const encountered = new Set(); const duplicates = new Set();
    for (const row of dataRows) { const emp = String(row[employeeColumnIndex] == null ? "" : row[employeeColumnIndex]).trim(); if (!emp) continue; if (encountered.has(emp)) duplicates.add(emp); else encountered.add(emp); }
    this.rows = dataRows.map((row, idx) => {
      const employeeNumber = String(row[employeeColumnIndex] == null ? "" : row[employeeColumnIndex]).trim();
      const managerEmployeeNumber = String(row[managerColumnIndex] == null ? "" : row[managerColumnIndex]).trim();
      let validationError = "";
      if (!employeeNumber) validationError = "Employee ID is blank.";
      else if (!managerEmployeeNumber) validationError = "Manager ID is blank.";
      else if (employeeNumber === managerEmployeeNumber) validationError = "Employee ID and Manager ID cannot be the same.";
      else if (duplicates.has(employeeNumber)) validationError = "Duplicate Employee ID exists in the pasted data.";
      return { rowNumber: idx + 2, employeeNumber, employeeName: "", employeeSalesforceId: "", managerEmployeeNumber, managerName: "", managerSalesforceId: "", currentManagerEmployeeNumber: "", currentManagerName: "", currentManagerSalesforceId: "", status: validationError ? STATUS.FAILED : STATUS.QUEUED, action: "", error: validationError };
    });
    if (this.rows.length === 0) { this.dataError = "No data rows were found."; this.didUpdate(); return; }
    const counts = this.counts(); this.generalMessage = this.rows.length + " row" + (this.rows.length === 1 ? "" : "s") + " parsed. " + counts.Queued + " queued and " + counts.Failed + " failed initial validation.";
    this.didUpdate();
  }

  clearData() { if (this.isWorking()) return; this.rows = []; this.dataError = ""; this.generalMessage = ""; this.confirmPopup = null; this.cancelRequested = false; this.didUpdate(); }

  counts() { const counts = {Queued:0, Processing:0, Succeeded:0, Failed:0}; for (const r of this.rows) if (Object.prototype.hasOwnProperty.call(counts, r.status)) counts[r.status]++; return counts; }

  visibleRows() { return this.rows.filter(r => this.showStatus[r.status] !== false); }

  batchSizeError() { const n = Number(this.batchSize); if (!Number.isInteger(n) || n < 1) return "Batch size must be a positive whole number."; if (n > 200) return "Batch size cannot be greater than 200."; return ""; }

  threadCountError() { const n = Number(this.threadCount); if (!Number.isInteger(n) || n < 1) return "Threads must be a positive whole number."; if (n > 6) return "Threads cannot be greater than 6."; return ""; }

  canRun() { return !this.isWorking() && !this.batchSizeError() && !this.threadCountError() && this.rows.some(r => r.status === STATUS.QUEUED); }

  requestRunUpdate() { if (!this.canRun()) return; const queuedCount = this.counts().Queued; this.confirmPopup = { title: "Confirm Manager Update", text: queuedCount + " user" + (queuedCount === 1 ? "" : "s") + " will be processed. The Manager field on matching Salesforce User records will be updated." }; this.didUpdate(); }

  cancelConfirmation() { this.confirmPopup = null; this.didUpdate(); }
  confirmRunUpdate() { if (!this.confirmPopup || !this.canRun()) { this.confirmPopup = null; this.didUpdate(); return; } this.confirmPopup = null; this.runUpdate(); }

  escapeSoqlValue(value) { return String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

  chunkArray(values, chunkSize) { const chunks = []; for (let i=0;i<values.length;i+=chunkSize) chunks.push(values.slice(i,i+chunkSize)); return chunks; }

  async queryAll(soql) { const firstUrl = "/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(soql); const all = []; let result = await sfConn.rest(firstUrl); if (result && Array.isArray(result.records)) all.push(...result.records); while (result && result.done === false && result.nextRecordsUrl) { result = await sfConn.rest(result.nextRecordsUrl); if (result && Array.isArray(result.records)) all.push(...result.records); } return all; }

  async resolveUsers() {
    const queuedRows = this.rows.filter(r => r.status === STATUS.QUEUED);
    if (queuedRows.length === 0) return;
    const unique = new Set(); for (const r of queuedRows) { unique.add(r.employeeNumber); unique.add(r.managerEmployeeNumber); }
    const numbers = Array.from(unique);
    const queryChunks = this.chunkArray(numbers, 150);
    const userRecords = [];
    for (const chunk of queryChunks) {
      if (this.cancelRequested) return;
      const inClause = chunk.map(v => "'" + this.escapeSoqlValue(v) + "'").join(",");
      const soql = "SELECT Id, Name, EmployeeNumber, ManagerId, Manager.Name, Manager.EmployeeNumber FROM User WHERE EmployeeNumber IN (" + inClause + ")";
      const recs = await this.queryAll(soql);
      userRecords.push(...recs);
    }
    const usersByEmployeeNumber = new Map();
    for (const u of userRecords) { const emp = String(u.EmployeeNumber == null ? "" : u.EmployeeNumber).trim(); if (!emp) continue; if (!usersByEmployeeNumber.has(emp)) usersByEmployeeNumber.set(emp, []); usersByEmployeeNumber.get(emp).push(u); }
    for (const row of queuedRows) {
      if (this.cancelRequested) return;
      const employeeMatches = usersByEmployeeNumber.get(row.employeeNumber) || [];
      const managerMatches = usersByEmployeeNumber.get(row.managerEmployeeNumber) || [];
      if (employeeMatches.length === 0) { this.failRow(row, "Employee ID was not found in Salesforce."); continue; }
      if (employeeMatches.length > 1) { this.failRow(row, "Multiple Salesforce Users have this Employee ID."); continue; }
      if (managerMatches.length === 0) { this.failRow(row, "Manager ID was not found in Salesforce."); continue; }
      if (managerMatches.length > 1) { this.failRow(row, "Multiple Salesforce Users have this Manager ID."); continue; }
      const employee = employeeMatches[0]; const manager = managerMatches[0];
      if (!employee.Id) { this.failRow(row, "Employee Salesforce User ID is missing."); continue; }
      if (!manager.Id) { this.failRow(row, "Manager Salesforce User ID is missing."); continue; }
      if (employee.Id === manager.Id) { this.failRow(row, "Employee and manager resolve to the same Salesforce User."); continue; }
      row.employeeSalesforceId = employee.Id; row.employeeName = employee.Name || ""; row.managerSalesforceId = manager.Id; row.managerName = manager.Name || "";
      row.currentManagerSalesforceId = employee.ManagerId || ""; row.currentManagerName = employee.Manager ? (employee.Manager.Name || "") : ""; row.currentManagerEmployeeNumber = employee.Manager ? (employee.Manager.EmployeeNumber || "") : "";
      if (employee.ManagerId && employee.ManagerId === manager.Id) { row.status = STATUS.SUCCEEDED; row.action = "No Change Required"; row.error = "The requested manager is already assigned."; }
    }
  }

  failRow(row, message) { row.status = STATUS.FAILED; row.action = ""; row.error = message; }

  async runUpdate() {
    if (!this.canRun()) return;
    this.isProcessingQueue = true; this.cancelRequested = false; this.dataError = ""; this.generalMessage = "Looking up employees and managers in Salesforce..."; this.didUpdate();
    try {
      await this.resolveUsers();
      if (this.cancelRequested) { this.isProcessingQueue = false; this.generalMessage = "Queued processing was cancelled."; this.didUpdate(); return; }
      const queuedRows = this.rows.filter(r => r.status === STATUS.QUEUED);
      if (queuedRows.length === 0) { this.isProcessingQueue = false; this.generalMessage = "No rows to process."; this.didUpdate(); return; }
      const batchSize = Math.max(1, Number(this.batchSize) || 50);
      const threadCount = Math.max(1, Math.min(6, Number(this.threadCount) || 1));
      const batches = this.chunkArray(queuedRows, batchSize);
      const wsdl = sfConn.wsdl(apiVersion, "Enterprise");

      const processBatch = async (batchRows) => {
        if (this.cancelRequested) return;
        for (const row of batchRows) { row.status = STATUS.PROCESSING; row.action = "Updating"; row.error = ""; }
        this.activeBatches++; this.didUpdate();
        const sObjects = batchRows.map(row => ({"$xsi:type": "sf:User", Id: row.employeeSalesforceId, ManagerId: row.managerSalesforceId}));
        try {
          const res = await this.spinFor(sfConn.soap(wsdl, "update", { sObjects }));
          const results = sfConn.asArray(res);
          for (let i = 0; i < results.length; i++) { const r = results[i]; const row = batchRows[i]; if (r && String(r.success) === "true") { row.status = STATUS.SUCCEEDED; row.action = "Updated"; row.error = ""; } else { row.status = STATUS.FAILED; row.action = ""; const errors = sfConn.asArray(r && r.errors); row.error = errors.map(e => (e.statusCode ? e.statusCode + ": " : "") + (e.message || JSON.stringify(e))).join(", "); } }
        } catch (err) { const msg = err && err.message ? err.message : String(err); for (const row of batchRows) { row.status = STATUS.FAILED; row.action = ""; row.error = msg; } } finally { this.activeBatches--; this.didUpdate(); }
      };

      const workers = [];
      for (let i = 0; i < threadCount; i++) {
        workers.push((async () => { while (!this.cancelRequested) { const batch = batches.shift(); if (!batch) break; await processBatch(batch); } })());
      }

      await Promise.all(workers);

      if (this.cancelRequested) this.generalMessage = "Queued processing was cancelled."; else { const counts = this.counts(); this.generalMessage = counts.Succeeded + " succeeded, " + counts.Failed + " failed."; }
    } catch (error) { this.dataError = "An unexpected error occurred while processing the queue."; console.error("Manager Update runUpdate failed", error); }
    finally { this.isProcessingQueue = false; this.didUpdate(); }
  }
}

class App extends React.Component {
  constructor(props) { super(props); this.onLoadClick = this.onLoadClick.bind(this); this.onClearClick = this.onClearClick.bind(this); this.onRunClick = this.onRunClick.bind(this); this.onCancelClick = this.onCancelClick.bind(this); this.onConfirmYes = this.onConfirmYes.bind(this); this.onConfirmNo = this.onConfirmNo.bind(this); }
  onLoadClick(e) { e.preventDefault(); const ta = document.getElementById("manager-input"); if (ta) this.props.model.setData(ta.value); }
  onClearClick(e) { e.preventDefault(); this.props.model.clearData(); }
  onRunClick(e) { e.preventDefault(); this.props.model.requestRunUpdate(); }
  onCancelClick(e) { e.preventDefault(); this.props.model.cancelRequested = true; this.props.model.didUpdate(); }
  onConfirmYes() { this.props.model.confirmRunUpdate(); }
  onConfirmNo() { this.props.model.cancelConfirmation(); }
  render() {
    const model = this.props.model;
    return h("div", {className: "main"},
      h("div", {className: "result-bar"}, h("h1", {}, "Manager Update"), h("div", {}, model.userInfo)),
      h("div", {className: "area"}, h("textarea", {id: "manager-input", placeholder: "Paste CSV or Excel data here", rows: 8}), h("div", {className: "button-group"}, h("button", {onClick: this.onLoadClick, disabled: model.isWorking()}, "Load Data"), h("button", {onClick: this.onClearClick, disabled: model.isWorking()}, "Clear"), h("button", {onClick: this.onRunClick, disabled: !model.canRun()}, "Run Update"), h("button", {onClick: this.onCancelClick, disabled: !model.isWorking()}, "Cancel")), model.dataError ? h("div", {className: "error"}, model.dataError) : null, h("div", {className: "message"}, model.generalMessage)),
      h("div", {className: "area result-area"}, h("table", {className: "result-table"}, h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Employee"), h("th", {}, "Manager"), h("th", {}, "Status"), h("th", {}, "Action"), h("th", {}, "Error"))), h("tbody", {}, model.visibleRows().map(row => h("tr", {key: row.rowNumber}, h("td", {}, row.rowNumber), h("td", {}, row.employeeNumber + (row.employeeName ? " - " + row.employeeName : "")), h("td", {}, row.managerEmployeeNumber + (row.managerName ? " - " + row.managerName : "")), h("td", {}, row.status), h("td", {}, row.action), h("td", {}, row.error)) )), model.confirmPopup ? h("div", {}, h("div", {id: "confirm-background"}, h("div", {id: "confirm-dialog"}, h("h1", {}, model.confirmPopup.title), h("p", {}, model.confirmPopup.text), h("div", {className: "dialog-buttons"}, h("button", {onClick: this.onConfirmYes}, "Yes"), h("button", {onClick: this.onConfirmNo, className: "cancel-btn"}, "Cancel") ) ) ) ) : null )
    );
  }
}

// Mount
{
  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {
    let root = document.getElementById("root");
    let model = new Model(sfHost);
    model.reactCallback = cb => { ReactDOM.render(h(App, {model}), root, cb); };
    ReactDOM.render(h(App, {model}), root);
    if (parent && parent.isUnitTest) parent.insextTestLoaded({model});
  });
}
/* global React ReactDOM */
/* global initButton */

import {sfConn, apiVersion} from "./inspector.js";
import {csvParse} from "./csv-parse.js";
import {copyToClipboard} from "./data-load.js";

const h = React.createElement;

const STATUS = Object.freeze({
  QUEUED: "Queued",
  PROCESSING: "Processing",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed"
});

const STANDARD_HEADERS = Object.freeze({
  EMPLOYEE: ["employee id", "employee number", "employeenumber", "employee"],
  MANAGER: ["manager id", "manager employee id", "manager employee number", "manageremployeenumber", "manager"]
});

class Model {
  constructor(sfHost) {
    this.sfHost = sfHost;
    this.sfLink = "https://" + sfHost;

    this.userInfo = "...";

    this.rows = [];
    this.dataError = "";
    this.generalMessage = "";

    this.batchSize = "50";
    this.threadCount = "2";

    this.activeBatches = 0;
    this.isProcessingQueue = false;
    this.cancelRequested = false;

    this.spinnerCount = 0;

    this.confirmPopup = null;

    this.reactCallback = null;
    this.testCallback = null;

    this.showStatus = {Queued: true, Processing: true, Succeeded: true, Failed: true};

    this.loadUserInfo();
  }

  didUpdate(cb) {
    if (this.reactCallback) this.reactCallback(cb);
    if (this.testCallback) this.testCallback();
  }

  spinFor(promise) {
    this.spinnerCount++;
    this.didUpdate();
    return promise
      .catch(err => { console.error("Manager Update operation failed", err); throw err; })
      .finally(() => { this.spinnerCount--; this.didUpdate(); });
  }

  loadUserInfo() {
    const request = sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {});
    this.spinFor(request)
      .then(result => {
        this.userInfo = [result.userFullName, result.userName, result.organizationName].filter(Boolean).join(" / ");
        this.didUpdate();
      })
      .catch(err => {
        this.userInfo = "Unable to load Salesforce user information";
        console.error("Unable to retrieve Salesforce user information", err);
        this.didUpdate();
      });
  }

  isWorking() { return this.isProcessingQueue || this.activeBatches > 0; }

  normalizeHeader(value) { return String(value == null ? "" : value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " "); }

  findHeaderIndex(headers, acceptedHeaders) {
    const normAccepted = acceptedHeaders.map(h => this.normalizeHeader(h));
    return headers.findIndex(header => normAccepted.includes(this.normalizeHeader(header)));
  }

  getSeparator(text) {
    const first = String(text || "").split(/\r?\n/)[0] || "";
    if (first.includes("\t")) return "\t";
    return ",";
  }

  setData(text) {
    if (this.isWorking()) return;

    this.rows = [];
    this.dataError = "";
    this.generalMessage = "";
    this.confirmPopup = null;
    this.cancelRequested = false;

    if (!text || !text.trim()) { this.dataError = "No data was pasted."; this.didUpdate(); return; }

    const separator = this.getSeparator(text);
    let parsed;
    try { parsed = csvParse(text, separator); } catch (e) { this.dataError = "Unable to read the pasted data: " + (e.message || String(e)); this.didUpdate(); return; }

    if (!Array.isArray(parsed) || parsed.length < 2) { this.dataError = "Paste a header row and at least one data row."; this.didUpdate(); return; }

    const headers = parsed.shift();
    if (!Array.isArray(headers)) { this.dataError = "The pasted header row is invalid."; this.didUpdate(); return; }

    const employeeColumnIndex = this.findHeaderIndex(headers, STANDARD_HEADERS.EMPLOYEE);
    const managerColumnIndex = this.findHeaderIndex(headers, STANDARD_HEADERS.MANAGER);

    if (employeeColumnIndex === -1) { this.dataError = "Employee ID column was not found. Use a header such as 'Employee ID' or 'Employee Number'."; this.didUpdate(); return; }
    if (managerColumnIndex === -1) { this.dataError = "Manager ID column was not found. Use a header such as 'Manager ID' or 'Manager Employee Number'."; this.didUpdate(); return; }
    if (employeeColumnIndex === managerColumnIndex) { this.dataError = "Employee ID and Manager ID must be separate columns."; this.didUpdate(); return; }

    const dataRows = parsed.filter(row => Array.isArray(row) && row.some(cell => String(cell == null ? "" : cell).trim() !== ""));

    const encountered = new Set();
    const duplicates = new Set();
    for (const row of dataRows) {
      const emp = String(row[employeeColumnIndex] == null ? "" : row[employeeColumnIndex]).trim();
      if (!emp) continue;
      if (encountered.has(emp)) duplicates.add(emp); else encountered.add(emp);
    }

    this.rows = dataRows.map((row, idx) => {
      const employeeNumber = String(row[employeeColumnIndex] == null ? "" : row[employeeColumnIndex]).trim();
      const managerEmployeeNumber = String(row[managerColumnIndex] == null ? "" : row[managerColumnIndex]).trim();
      let validationError = "";
      if (!employeeNumber) validationError = "Employee ID is blank.";
      else if (!managerEmployeeNumber) validationError = "Manager ID is blank.";
      else if (employeeNumber === managerEmployeeNumber) validationError = "Employee ID and Manager ID cannot be the same.";
      else if (duplicates.has(employeeNumber)) validationError = "Duplicate Employee ID exists in the pasted data.";

      return {
        rowNumber: idx + 2,
        employeeNumber,
        employeeName: "",
        employeeSalesforceId: "",
        managerEmployeeNumber,
        managerName: "",
        managerSalesforceId: "",
        currentManagerEmployeeNumber: "",
        currentManagerName: "",
        currentManagerSalesforceId: "",
        status: validationError ? STATUS.FAILED : STATUS.QUEUED,
        action: "",
        error: validationError
      };
    });

    if (this.rows.length === 0) { this.dataError = "No data rows were found."; this.didUpdate(); return; }

    const counts = this.counts();
    this.generalMessage = this.rows.length + " row" + (this.rows.length === 1 ? "" : "s") + " parsed. " + counts.Queued + " queued and " + counts.Failed + " failed initial validation.";
    this.didUpdate();
  }

  clearData() { if (this.isWorking()) return; this.rows = []; this.dataError = ""; this.generalMessage = ""; this.confirmPopup = null; this.cancelRequested = false; this.didUpdate(); }

  counts() { const counts = {Queued:0, Processing:0, Succeeded:0, Failed:0}; for (const r of this.rows) if (Object.prototype.hasOwnProperty.call(counts, r.status)) counts[r.status]++; return counts; }

  visibleRows() { return this.rows.filter(r => this.showStatus[r.status] !== false); }

  batchSizeError() { const n = Number(this.batchSize); if (!Number.isInteger(n) || n < 1) return "Batch size must be a positive whole number."; if (n > 200) return "Batch size cannot be greater than 200."; return ""; }

  threadCountError() { const n = Number(this.threadCount); if (!Number.isInteger(n) || n < 1) return "Threads must be a positive whole number."; if (n > 6) return "Threads cannot be greater than 6."; return ""; }

  canRun() { return !this.isWorking() && !this.batchSizeError() && !this.threadCountError() && this.rows.some(r => r.status === STATUS.QUEUED); }

  requestRunUpdate() { if (!this.canRun()) return; const queuedCount = this.counts().Queued; this.confirmPopup = { title: "Confirm Manager Update", text: queuedCount + " user" + (queuedCount === 1 ? "" : "s") + " will be processed. The Manager field on matching Salesforce User records will be updated." }; this.didUpdate(); }

  cancelConfirmation() { this.confirmPopup = null; this.didUpdate(); }
  confirmRunUpdate() { if (!this.confirmPopup || !this.canRun()) { this.confirmPopup = null; this.didUpdate(); return; } this.confirmPopup = null; this.runUpdate(); }

  escapeSoqlValue(value) { return String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }

  chunkArray(values, chunkSize) { const chunks = []; for (let i=0;i<values.length;i+=chunkSize) chunks.push(values.slice(i,i+chunkSize)); return chunks; }

  async queryAll(soql) {
    const firstUrl = "/services/data/v" + apiVersion + "/query/?q=" + encodeURIComponent(soql);
    const all = [];
    let result = await sfConn.rest(firstUrl);
    if (result && Array.isArray(result.records)) all.push(...result.records);
    while (result && result.done === false && result.nextRecordsUrl) { result = await sfConn.rest(result.nextRecordsUrl); if (result && Array.isArray(result.records)) all.push(...result.records); }
    return all;
  }

  async resolveUsers() {
    const queuedRows = this.rows.filter(r => r.status === STATUS.QUEUED);
    if (queuedRows.length === 0) return;
    const unique = new Set();
    for (const r of queuedRows) { unique.add(r.employeeNumber); unique.add(r.managerEmployeeNumber); }
    const numbers = Array.from(unique);
    const queryChunks = this.chunkArray(numbers, 150);
    const userRecords = [];
    for (const chunk of queryChunks) {
      if (this.cancelRequested) return;
      const inClause = chunk.map(v => "'" + this.escapeSoqlValue(v) + "'").join(",");
      const soql = "SELECT Id, Name, EmployeeNumber, ManagerId, Manager.Name, Manager.EmployeeNumber FROM User WHERE EmployeeNumber IN (" + inClause + ")";
      const recs = await this.queryAll(soql);
      userRecords.push(...recs);
    }
    const usersByEmployeeNumber = new Map();
    for (const u of userRecords) { const emp = String(u.EmployeeNumber == null ? "" : u.EmployeeNumber).trim(); if (!emp) continue; if (!usersByEmployeeNumber.has(emp)) usersByEmployeeNumber.set(emp, []); usersByEmployeeNumber.get(emp).push(u); }
    for (const row of queuedRows) {
      if (this.cancelRequested) return;
      const employeeMatches = usersByEmployeeNumber.get(row.employeeNumber) || [];
      const managerMatches = usersByEmployeeNumber.get(row.managerEmployeeNumber) || [];
      if (employeeMatches.length === 0) { this.failRow(row, "Employee ID was not found in Salesforce."); continue; }
      if (employeeMatches.length > 1) { this.failRow(row, "Multiple Salesforce Users have this Employee ID."); continue; }
      if (managerMatches.length === 0) { this.failRow(row, "Manager ID was not found in Salesforce."); continue; }
      if (managerMatches.length > 1) { this.failRow(row, "Multiple Salesforce Users have this Manager ID."); continue; }
      const employee = employeeMatches[0]; const manager = managerMatches[0];
      if (!employee.Id) { this.failRow(row, "Employee Salesforce User ID is missing."); continue; }
      if (!manager.Id) { this.failRow(row, "Manager Salesforce User ID is missing."); continue; }
      if (employee.Id === manager.Id) { this.failRow(row, "Employee and manager resolve to the same Salesforce User."); continue; }
      row.employeeSalesforceId = employee.Id; row.employeeName = employee.Name || ""; row.managerSalesforceId = manager.Id; row.managerName = manager.Name || "";
      row.currentManagerSalesforceId = employee.ManagerId || "";
      row.currentManagerName = employee.Manager ? (employee.Manager.Name || "") : "";
      row.currentManagerEmployeeNumber = employee.Manager ? (employee.Manager.EmployeeNumber || "") : "";
      if (employee.ManagerId && employee.ManagerId === manager.Id) { row.status = STATUS.SUCCEEDED; row.action = "No Change Required"; row.error = "The requested manager is already assigned."; }
    }
  }

  failRow(row, message) { row.status = STATUS.FAILED; row.action = ""; row.error = message; }

  async runUpdate() {
    if (!this.canRun()) return;
    this.isProcessingQueue = true; this.cancelRequested = false; this.dataError = ""; this.generalMessage = "Looking up employees and managers in Salesforce..."; this.didUpdate();
    try {
      await this.resolveUsers();
      if (this.cancelRequested) { this.isProcessingQueue = false; this.generalMessage = "Queued processing was cancelled."; this.didUpdate(); return; }
      const queuedRows = this.rows.filter(r => r.status === STATUS.QUEUED);
      if (queuedRows.length === 0) { this.isProcessingQueue = false; this.generalMessage = "No rows to process."; this.didUpdate(); return; }
      const batchSize = Math.max(1, Number(this.batchSize) || 50);
      const threadCount = Math.max(1, Math.min(6, Number(this.threadCount) || 1));
      const batches = this.chunkArray(queuedRows, batchSize);
      const wsdl = sfConn.wsdl(apiVersion, "Enterprise");

      const processBatch = async (batchRows) => {
        if (this.cancelRequested) return;
        for (const row of batchRows) { row.status = STATUS.PROCESSING; row.action = "Updating"; row.error = ""; }
        this.activeBatches++; this.didUpdate();
        const sObjects = batchRows.map(row => ({"$xsi:type": "sf:User", Id: row.employeeSalesforceId, ManagerId: row.managerSalesforceId}));
        try {
          const res = await this.spinFor(sfConn.soap(wsdl, "update", { sObjects }));
          const results = sfConn.asArray(res);
          for (let i = 0; i < results.length; i++) {
            const r = results[i]; const row = batchRows[i];
            if (r && String(r.success) === "true") { row.status = STATUS.SUCCEEDED; row.action = "Updated"; row.error = ""; }
            else { row.status = STATUS.FAILED; row.action = ""; const errors = sfConn.asArray(r && r.errors); row.error = errors.map(e => (e.statusCode ? e.statusCode + ": " : "") + (e.message || JSON.stringify(e))).join(", "); }
          }
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          for (const row of batchRows) { row.status = STATUS.FAILED; row.action = ""; row.error = msg; }
        } finally { this.activeBatches--; this.didUpdate(); }
      };

      const workers = [];
      for (let i = 0; i < threadCount; i++) {
        workers.push((async () => {
          while (!this.cancelRequested) {
            const batch = batches.shift();
            if (!batch) break;
            await processBatch(batch);
          }
        })());
      }

      await Promise.all(workers);

      if (this.cancelRequested) this.generalMessage = "Queued processing was cancelled.";
      else { const counts = this.counts(); this.generalMessage = counts.Succeeded + " succeeded, " + counts.Failed + " failed."; }
    } catch (error) {
      this.dataError = "An unexpected error occurred while processing the queue.";
      console.error("Manager Update runUpdate failed", error);
    } finally {
      this.isProcessingQueue = false; this.didUpdate();
    }
  }
}

class App extends React.Component {
  constructor(props) { super(props); this.onLoadClick = this.onLoadClick.bind(this); this.onClearClick = this.onClearClick.bind(this); this.onRunClick = this.onRunClick.bind(this); this.onCancelClick = this.onCancelClick.bind(this); this.onConfirmYes = this.onConfirmYes.bind(this); this.onConfirmNo = this.onConfirmNo.bind(this); }
  onLoadClick(e) { e.preventDefault(); const ta = document.getElementById("manager-input"); if (ta) this.props.model.setData(ta.value); }
  onClearClick(e) { e.preventDefault(); this.props.model.clearData(); }
  onRunClick(e) { e.preventDefault(); this.props.model.requestRunUpdate(); }
  onCancelClick(e) { e.preventDefault(); this.props.model.cancelRequested = true; this.props.model.didUpdate(); }
  onConfirmYes() { this.props.model.confirmRunUpdate(); }
  onConfirmNo() { this.props.model.cancelConfirmation(); }
  render() {
    const model = this.props.model;
    return h("div", {className: "main"},
      h("div", {className: "result-bar"}, h("h1", {}, "Manager Update"), h("div", {}, model.userInfo)),
      h("div", {className: "area"}, h("textarea", {id: "manager-input", placeholder: "Paste CSV or Excel data here", rows: 8}), h("div", {className: "button-group"}, h("button", {onClick: this.onLoadClick, disabled: model.isWorking()}, "Load Data"), h("button", {onClick: this.onClearClick, disabled: model.isWorking()}, "Clear"), h("button", {onClick: this.onRunClick, disabled: !model.canRun()}, "Run Update"), h("button", {onClick: this.onCancelClick, disabled: !model.isWorking()}, "Cancel")), model.dataError ? h("div", {className: "error"}, model.dataError) : null, h("div", {className: "message"}, model.generalMessage)),
      h("div", {className: "area result-area"}, h("table", {className: "result-table"}, h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Employee"), h("th", {}, "Manager"), h("th", {}, "Status"), h("th", {}, "Action"), h("th", {}, "Error"))), h("tbody", {}, model.visibleRows().map(row => h("tr", {key: row.rowNumber}, h("td", {}, row.rowNumber), h("td", {}, row.employeeNumber + (row.employeeName ? " - " + row.employeeName : "")), h("td", {}, row.managerEmployeeNumber + (row.managerName ? " - " + row.managerName : "")), h("td", {}, row.status), h("td", {}, row.action), h("td", {}, row.error)) )), model.confirmPopup ? h("div", {}, h("div", {id: "confirm-background"}, h("div", {id: "confirm-dialog"}, h("h1", {}, model.confirmPopup.title), h("p", {}, model.confirmPopup.text), h("div", {className: "dialog-buttons"}, h("button", {onClick: this.onConfirmYes}, "Yes"), h("button", {onClick: this.onConfirmNo, className: "cancel-btn"}, "Cancel") ) ) ) ) : null )
    );
  }
}

// Mount
{
  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {
    let root = document.getElementById("root");
    let model = new Model(sfHost);
    model.reactCallback = cb => { ReactDOM.render(h(App, {model}), root, cb); };
    ReactDOM.render(h(App, {model}), root);
    if (parent && parent.isUnitTest) parent.insextTestLoaded({model});
  });
}


class App extends React.Component {
  constructor(props) {
    super(props);
    this.onLoadClick = this.onLoadClick.bind(this);
    this.onClearClick = this.onClearClick.bind(this);
    this.onRunClick = this.onRunClick.bind(this);
    this.onCancelClick = this.onCancelClick.bind(this);
    this.onConfirmPopupYesClick = this.onConfirmPopupYesClick.bind(this);
    this.onConfirmPopupNoClick = this.onConfirmPopupNoClick.bind(this);
  }

  onLoadClick(e) {
    e.preventDefault();
    const ta = document.getElementById("manager-input");
    if (ta) {
      this.props.model.setData(ta.value);
    }
  }

  onClearClick(e) {
    e.preventDefault();
    this.props.model.clearData();
  }

  onRunClick(e) {
    e.preventDefault();
    this.props.model.requestRunUpdate();
  }

  onCancelClick(e) {
    e.preventDefault();
    this.props.model.cancelRequested = true;
    this.props.model.didUpdate();
  }

  onConfirmPopupYesClick() {
    this.props.model.confirmRunUpdate();
  }

  onConfirmPopupNoClick() {
    this.props.model.cancelConfirmation();
  }

  render() {
    const model = this.props.model;

    return h("div", {className: "main"},
      h("div", {className: "result-bar"},
        h("h1", {}, "Manager Update"),
        h("div", {}, model.userInfo)
      ),
      h("div", {className: "area"},
        h("textarea", {id: "manager-input", placeholder: "Paste CSV or Excel data here", rows: 8}),
        h("div", {className: "button-group"},
          h("button", {onClick: this.onLoadClick, disabled: model.isWorking()}, "Load Data"),
          h("button", {onClick: this.onClearClick, disabled: model.isWorking()}, "Clear"),
          h("button", {onClick: this.onRunClick, disabled: !model.canRun()}, "Run Update"),
          h("button", {onClick: this.onCancelClick, disabled: !model.isWorking()}, "Cancel")
        ),
        model.dataError ? h("div", {className: "error"}, model.dataError) : null,
        h("div", {className: "message"}, model.generalMessage)
      ),
      h("div", {className: "area result-area"},
        h("table", {className: "result-table"},
          h("thead", {}, h("tr", {},
            h("th", {}, "#"),
            h("th", {}, "Employee"),
            h("th", {}, "Manager"),
            h("th", {}, "Status"),
            h("th", {}, "Action"),
            h("th", {}, "Error")
          )),
          h("tbody", {}, model.visibleRows().map(row =>
            h("tr", {key: row.rowNumber},
              h("td", {}, row.rowNumber),
              h("td", {}, row.employeeNumber + (row.employeeName ? " - " + row.employeeName : "")),
              h("td", {}, row.managerEmployeeNumber + (row.managerName ? " - " + row.managerName : "")),
              h("td", {}, row.status),
              h("td", {}, row.action),
              h("td", {}, row.error)
            )
          ))
        ),
        model.confirmPopup ? h("div", {},
          h("div", {id: "confirm-background"},
            h("div", {id: "confirm-dialog"},
              h("h1", {}, model.confirmPopup.title),
              h("p", {}, model.confirmPopup.text),
              h("div", {className: "dialog-buttons"},
                h("button", {onClick: this.onConfirmPopupYesClick}, "Yes"),
                h("button", {onClick: this.onConfirmPopupNoClick, className: "cancel-btn"}, "Cancel")
              )
            )
          )
        ) : null
      )
    );
  }
}

{
  let args = new URLSearchParams(location.search.slice(1));
  let sfHost = args.get("host");
  initButton(sfHost, true);
  sfConn.getSession(sfHost).then(() => {

    let root = document.getElementById("root");
    let model = new Model(sfHost);
    model.reactCallback = cb => {
      ReactDOM.render(h(App, {model}), root, cb);
    };
    ReactDOM.render(h(App, {model}), root);

    if (parent && parent.isUnitTest) { // for unit tests
      parent.insextTestLoaded({model});
    }

  });
}
        this.isProcessingQueue = false;
        this.generalMessage =
          "Queued processing was cancelled.";

        this.didUpdate();
        return;
      }

      // Build the list of rows to process (still QUEUED)
      const queuedRows = this.rows.filter(r => r.status === STATUS.QUEUED);

      if (queuedRows.length === 0) {
        this.isProcessingQueue = false;
        this.generalMessage = "No rows to process.";
        this.didUpdate();
        return;
      }

      const batchSize = Math.max(1, Number(this.batchSize) || 50);
      const threadCount = Math.max(1, Math.min(6, Number(this.threadCount) || 1));

      // Create batches of queued rows
      const batches = this.chunkArray(queuedRows, batchSize);

      // Worker function that processes batches until none remain
      const wsdl = sfConn.wsdl(apiVersion, "Enterprise");

      const processBatch = async (batchRows) => {
        if (this.cancelRequested) return;

        // Mark rows processing
        for (const row of batchRows) {
          row.status = STATUS.PROCESSING;
          row.action = "Updating";
          row.error = "";
        }
        this.activeBatches++;
        this.didUpdate();

        // Build sObjects for SOAP update
        const sObjects = batchRows.map(row => {
          return {
            "$xsi:type": "sf:User",
            Id: row.employeeSalesforceId,
            ManagerId: row.managerSalesforceId
          };
        });

        try {
          const args = { sObjects };
          const result = await this.spinFor(sfConn.soap(wsdl, "update", args));

          const results = sfConn.asArray(result);

          for (let i = 0; i < results.length; i++) {
            const res = results[i];
            const row = batchRows[i];

            if (res && String(res.success) === "true") {
              row.status = STATUS.SUCCEEDED;
              row.action = "Updated";
              row.error = "";
            } else {
              row.status = STATUS.FAILED;
              row.action = "";
              const errors = sfConn.asArray(res && res.errors);
              row.error = errors.map(e => (e.statusCode ? e.statusCode + ": " : "") + (e.message || JSON.stringify(e))).join(", ");
            }
          }
        } catch (err) {
          // Treat as batch-level failure
          const errMsg = err && err.message ? err.message : String(err);
          for (const row of batchRows) {
            row.status = STATUS.FAILED;
            row.action = "";
            row.error = errMsg;
          }
        } finally {
          this.activeBatches--;
          this.didUpdate();
        }
      };

      // Launch up to threadCount concurrent workers
      const workers = [];
      while (batches.length > 0 && workers.length < threadCount) {
        const batch = batches.shift();
        const p = processBatch(batch);
        workers.push(p);
      }

      // As workers finish, start additional batches until none remain
      for (const w of workers) {
        await w;
        if (this.cancelRequested) break;

        while (batches.length > 0 && !this.cancelRequested) {
          const nextBatch = batches.shift();
          await processBatch(nextBatch);
        }
      }

      if (this.cancelRequested) {
        this.generalMessage = "Queued processing was cancelled.";
      } else {
        const counts = this.counts();
        this.generalMessage =
          "Processing complete: "
          + counts.Succeeded + " succeeded, "
          + counts.Failed + " failed.";
      }

      this.isProcessingQueue = false;
      this.didUpdate();
      
