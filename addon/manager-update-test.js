/* global React ReactDOM */
import {sfConn, apiVersion} from "./inspector.js";
/* global initButton */
import {csvParse} from "./csv-parse.js";
import {DescribeInfo, copyToClipboard, initScrollTable} from "./data-load.js";


console.log("check one");

let h = React.createElement;

class Model {

  constructor(sfHost, args) {
    this.sfHost = sfHost;
    this.importData = undefined;
    this.consecutiveFailures = 0;

    this.sfLink = "https://" + this.sfHost;
    this.spinnerCount = 0;
    this.showHelp = false;
    this.userInfo = "...";
    this.activeBatches = 0;
    this.isProcessingQueue = false;
    this.importType = "Account";

    if (args.has("sobject")) {
      this.importType = args.get("sobject");
    }
    let trialExpDate = localStorage.getItem(sfHost + "_trialExpirationDate");
    if (localStorage.getItem(sfHost + "_isSandbox") != "true" && (!trialExpDate || trialExpDate === "null")) {
      //change background color for production
      document.body.classList.add("prod");
    }
    this.importTableResult = null;
    this.updateResult(null);

    this.describeInfo = new DescribeInfo(this.spinFor.bind(this), () => { this.refreshColumn(); });
    this.spinFor(sfConn.soap(sfConn.wsdl(apiVersion, "Partner"), "getUserInfo", {}).then(res => {
      this.userInfo = res.userFullName + " / " + res.userName + " / " + res.organizationName;
    }));

    let apiTypeParam = args.get("apitype");
    this.apiType = this.importType.endsWith("__mdt") ? "Metadata" : apiTypeParam ? apiTypeParam : "Enterprise";

    if (args.has("data")) {
      let data = atob(args.get("data"));
      this.dataFormat = "csv";
      this.setData(data);
      this.updateAvailableActions();
      this.importAction = this.importType.endsWith("__mdt") ? "deleteMetadata" : "delete";
      this.importActionName = this.importType.endsWith("__mdt") ? "Delete Metadata" : "Delete";
      this.skipAllUnknownFields();
      console.log(this.importData);
    }
  }


  /**
   * Notify React that we changed something, so it will rerender the view.
   * Should only be called once at the end of an event or asynchronous operation, since each call can take some time.
   * All event listeners (functions starting with "on") should call this function if they update the model.
   * Asynchronous operations should use the spinFor function, which will call this function after the asynchronous operation completes.
   * Other functions should not call this function, since they are called by a function that does.
   * @param cb A function to be called once React has processed the update.
   */
  didUpdate(cb) {
    if (this.reactCallback) {
      this.reactCallback(cb);
    }
    if (this.testCallback) {
      this.testCallback();
    }
  }


  /**
   * Show the spinner while waiting for a promise.
   * didUpdate() must be called after calling spinFor.
   * didUpdate() is called when the promise is resolved or rejected, so the caller doesn't have to call it, when it updates the model just before resolving the promise, for better performance.
   * @param promise The promise to wait for.
   */
  spinFor(promise) {
    this.spinnerCount++;
    promise
      .catch(err => {
        console.error("spinFor", err);
      })
      .then(() => {
        this.spinnerCount--;
        this.didUpdate();
      })
      .catch(err => console.log("error handling failed", err));
  }

  getFormat(text) {
    const trimmedText = text.trim();

    if (trimmedText.startsWith("{") || trimmedText.startsWith("[")) {
      try {
        JSON.parse(trimmedText);
        return "json";
      } catch (e) {
        this.errorText = e;
      }
    }
    if (trimmedText.includes("\t")) {
      return "excel";
    }
    if (trimmedText.includes(",") && !trimmedText.includes("\t")) {
      return "csv";
    }
    return "";
  }



    setData(text) {
      if (this.isWorking()) {
        return;
      }
      this.dataFormat = this.getFormat(text);
      if (this.dataFormat == "json") {
        text = this.getDataFromJson(text);
      }
      let csvSeparator = ",";
      if (localStorage.getItem("csvSeparator")) {
        csvSeparator = localStorage.getItem("csvSeparator");
      }
      let separator = this.dataFormat == "excel" ? "\t" : csvSeparator;
      let data;
      try {
        data = csvParse(text, separator);
      } catch (e) {
        this.dataError = "Error: " + e.message;
        this.updateResult(null);
        return;
      }
  
      if (data[0] && data[0][0] && data[0][0].trimStart().startsWith("salesforce-inspector-import-options")) {
        let importOptions = new URLSearchParams(data.shift()[0].trim());
        if (importOptions.get("useToolingApi") == "1") this.apiType = "Tooling";
        if (importOptions.get("useToolingApi") == "0") this.apiType = "Enterprise";
        // Keep the above two checks, in order to support old import options
        if (allApis.some(api => api.value == importOptions.get("apiType"))) this.apiType = importOptions.get("apiType");
        if (importOptions.get("action") == "create") this.importAction = "create";
        if (importOptions.get("action") == "update") this.importAction = "update";
        if (importOptions.get("action") == "upsert") this.importAction = "upsert";
        if (importOptions.get("action") == "delete") this.importAction = "delete";
        if (importOptions.get("object")) this.importType = importOptions.get("object");
        if (importOptions.get("externalId") && this.importAction == "upsert") this.externalId = importOptions.get("externalId");
        if (importOptions.get("batchSize")) this.batchSize = importOptions.get("batchSize");
        if (importOptions.get("threads")) this.batchConcurrency = importOptions.get("threads");
      }
  
      if (data.length < 2) {
        this.dataError = "Error: No records to import";
        this.updateResult(null);
        return;
      }
      this.dataError = "";
      let header = data.shift().map((c, index) => this.makeColumn(c, index));
      this.updateResult(null); // Two updates, the first clears state from the scrolltable
      this.updateResult({header, data});
  
      //automatically select the SObject if possible
      let sobj = this.getSObject(data);
      if (sobj) {
        //We avoid overwriting the Tooling option in case it was already set
        this.apiType = sobj.endsWith("__mdt") ? "Metadata" : this.apiType === "Tooling" ? "Tooling" : "Enterprise";
        this.updateAvailableActions();
        this.importType = sobj;
      }
      //automatically select update if header contains id
      if (this.hasIdColumn(header) && !this.importActionSelected && this.apiType != "Metadata") {
        this.importAction = "update";
        this.importActionName = "Update";
      }
      this.refreshColumn();
      this.updateResult(this.importData.importTable);
    }




  updateResult(importTable) {
    let counts = {Queued: 0, Processing: 0, Succeeded: 0, Failed: 0};
    if (!importTable) {
      this.importData = {
        importTable: null,
        counts,
        taggedRows: null
      };
      this.updateImportTableResult();
      return;
    }
    let statusColumnIndex = importTable.header.findIndex(c => c.columnValue.toLowerCase() == "__status");
    let taggedRows = [];
    for (let cells of importTable.data) {
      let status = statusColumnIndex < 0 ? "Queued"
        : cells[statusColumnIndex].toLowerCase() == "queued" ? "Queued"
        : cells[statusColumnIndex].toLowerCase() == "" ? "Queued"
        : cells[statusColumnIndex].toLowerCase() == "processing" && !this.isWorking() ? "Queued"
        : cells[statusColumnIndex].toLowerCase() == "processing" ? "Processing"
        : cells[statusColumnIndex].toLowerCase() == "succeeded" ? "Succeeded"
        : "Failed";
      counts[status]++;
      taggedRows.push({status, cells});
    }
    // Note: caller will call this.executeBatch() if needed
    this.importData = {importTable, counts, taggedRows};
    this.updateImportTableResult();
  }

  getSObject(data) {
    if (data[0][0].startsWith("[") && data[0][0].endsWith("]")) {
      let obj = data[0][0].substr(1, data[0][0].length - 2);
      return obj;
    }

    // Check if we have an ID field in the data
    const idIndex = this.importData.importTable.header.findIndex(col => col.columnValue.toLowerCase() === "id");
    if (idIndex !== -1 && data[0] && data[0][idIndex]) {
      const idValue = data[0][idIndex];
      if (idValue && idValue.length >= 3) {
        const prefix = idValue.substring(0, 3);

        const matchingObject = this.sobjectList().find(sobject => sobject.keyPrefix === prefix);
        if (matchingObject) {
          return matchingObject.name;
        }
      }
    }
    return "";
  }


  // Must be called whenever any of its inputs changes.
  updateImportTableResult() {
    if (this.importData.taggedRows == null) {
      this.importTableResult = null;
      if (this.resultTableCallback) {
        this.resultTableCallback(this.importTableResult);
      }
      return;
    }
    let header = this.importData.importTable.header.map(c => c.columnValue);
    let data = this.importData.taggedRows.map(row => row.cells);
    this.importTableResult = {
      table: [header, ...data],
      isTooling: this.apiType == "Tooling",
      describeInfo: this.describeInfo,
      sfHost: this.sfHost,
      rowVisibilities: [true, ...this.importData.taggedRows.map(row => this.showStatus[row.status])],
      colVisibilities: header.map(() => true)
    };
    if (this.resultTableCallback) {
      this.resultTableCallback(this.importTableResult);
    }
  }


  isWorking() {
    return this.activeBatches != 0 || this.isProcessingQueue;
  }



  batchSizeError() {
    if (!(+this.batchSize > 0)) { // This also handles NaN
      return "Error: Must be a positive number";
    }
    return "";
  }

  batchConcurrencyError() {
    if (!(+this.batchConcurrency > 0)) { // This also handles NaN
      return "Error: Must be a positive number";
    }
    if (+this.batchConcurrency > 6) {
      return "Note: More than 6 threads will not help since Salesforce does not support HTTP2";
    }
    return "";
  }



}



function csvSerialize(table, separator) {
  return table.map(row => row.map(text => "\"" + ("" + (text == null ? "" : text)).split("\"").join("\"\"") + "\"").join(separator)).join("\r\n");
}



class App extends React.Component {
  constructor(props) {
    super(props);
    this.onApiTypeChange = this.onApiTypeChange.bind(this);
    this.onImportActionChange = this.onImportActionChange.bind(this);
    this.onImportTypeChange = this.onImportTypeChange.bind(this);
    this.onDataPaste = this.onDataPaste.bind(this);
    this.onExternalIdChange = this.onExternalIdChange.bind(this);
    this.onBatchSizeChange = this.onBatchSizeChange.bind(this);
    this.onCustomHeadersChange = this.onCustomHeadersChange.bind(this);
    this.onCustomHeadersKeyPress = this.onCustomHeadersKeyPress.bind(this);
    this.onBatchConcurrencyChange = this.onBatchConcurrencyChange.bind(this);
    this.onToggleHelpClick = this.onToggleHelpClick.bind(this);
    this.onDoImportClick = this.onDoImportClick.bind(this);
    this.onToggleProcessingClick = this.onToggleProcessingClick.bind(this);
    this.onRetryFailedClick = this.onRetryFailedClick.bind(this);
    this.onCopyAsExcelClick = this.onCopyAsExcelClick.bind(this);
    this.onCopyAsCsvClick = this.onCopyAsCsvClick.bind(this);
    this.onCopyOptionsClick = this.onCopyOptionsClick.bind(this);
    this.onSkipAllUnknownFieldsClick = this.onSkipAllUnknownFieldsClick.bind(this);
    this.onConfirmPopupYesClick = this.onConfirmPopupYesClick.bind(this);
    this.onConfirmPopupNoClick = this.onConfirmPopupNoClick.bind(this);
    this.unloadListener = null;
    this.state = {templateValueIndex: -1};
  }
  onApiTypeChange(e) {
    let {model} = this.props;
    model.apiType = e.target.value;
    model.updateAvailableActions();
    model.importAction = model.availableActions[0].value;
    model.importActionName = allActions.find(action => action.value == model.importAction).label;
    model.updateImportTableResult();
    model.didUpdate();
  }
  onImportActionChange(e) {
    let {model} = this.props;
    model.importAction = e.target.value;
    model.importActionName = e.target.options[e.target.selectedIndex].text;
    model.importActionSelected = true;
    if (model.importAction === "undelete"){
      this.onImportUndelete(model);
    }
    model.didUpdate();
  }
  onImportTypeChange(e) {
    let {model} = this.props;
    model.importType = e.target.value;
    model.refreshColumn();
    model.didUpdate();
  }
  onDataPaste(e) {
    let {model} = this.props;
    let text = e.clipboardData.getData("text/plain");
    model.setData(text);
    model.didUpdate();
  }
  onExternalIdChange(e) {
    let {model} = this.props;
    model.externalId = e.target.value;
    model.didUpdate();
  }
  onBatchSizeChange(e) {
    let {model} = this.props;
    model.batchSize = e.target.value;
    model.executeBatch();
    model.didUpdate();
  }
  onCustomHeadersKeyPress(e){
    if (e.key == "ArrowDown" || e.key == "ArrowUp"){
      let {model} = this.props;
      let {templateValueIndex} = this.state;
      let down = e.key == "ArrowDown" ? true : false;
      down ? templateValueIndex++ : templateValueIndex--;
      if (0 <= templateValueIndex && templateValueIndex < headersTemplates.length){
        model.customHeaders = headersTemplates[templateValueIndex];
        this.setState({templateValueIndex});
        model.didUpdate();
      }
    }
  }
  onCustomHeadersChange(e){
    let {model} = this.props;
    model.customHeaders = e.target.value;
    model.didUpdate();
  }
  onBatchConcurrencyChange(e) {
    let {model} = this.props;
    model.batchConcurrency = e.target.value;
    model.executeBatch();
    model.didUpdate();
  }
  onToggleHelpClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.showHelp = !model.showHelp;
    model.didUpdate(() => {
      this.scrollTable.viewportChange();
    });
  }
  onDoImportClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.doImport();
    model.didUpdate();
  }
  onToggleProcessingClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.isProcessingQueue = !model.isProcessingQueue;
    model.executeBatch();
    model.didUpdate();
  }
  onRetryFailedClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.retryFailed();
    model.didUpdate();
  }
  onCopyAsExcelClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.copyResult("\t");
  }
  onCopyAsCsvClick(e) {
    e.preventDefault();
    let {model} = this.props;
    let separator = ",";
    if (localStorage.getItem("csvSeparator")) {
      separator = localStorage.getItem("csvSeparator");
    }
    model.copyResult(separator);
  }
  onCopyOptionsClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.copyOptions();
  }
  onSkipAllUnknownFieldsClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.skipAllUnknownFields();
  }
  onConfirmPopupYesClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.confirmPopupYes();
    model.didUpdate();
  }
  onConfirmPopupNoClick(e) {
    e.preventDefault();
    let {model} = this.props;
    model.confirmPopupNo();
    model.didUpdate();
  }
  onImportUndelete(model){
    //reinit import table to remove __Status column to be able to undelete rows after deleting it
    if (model.importData.importTable.header.find(c => c.columnValue == "__Status")) {
      //get indexes to remove
      const indices = model.importData.importTable.header.map((element, index) => element.columnValue.startsWith("__") ? index : undefined).filter(index => index !== undefined);
      //remove indexes from header and data
      model.importData.importTable.header = model.importData.importTable.header.filter((element, index) => !indices.includes(index));
      model.importData.importTable.data = model.importData.importTable.data.map(innerArray => innerArray.filter((element, index) => !indices.includes(index)));

      model.importCounts().Queued = model.importData.importTable.data.length;
      model.updateImportTableResult();
    }
  }
  componentDidMount() {
    let {model} = this.props;

    addEventListener("resize", () => { this.scrollTable.viewportChange(); });

    this.scrollTable = initScrollTable(this.refs.scroller);
    model.resultTableCallback = this.scrollTable.dataChange;
    model.updateImportTableResult();
  }
  componentDidUpdate() {
    let {model} = this.props;

    // We completely remove the listener when not needed (as opposed to just not setting returnValue in the listener),
    // because having the listener disables BFCache in Firefox (even if the listener does nothing).
    // Chrome does not have a BFCache.
    if (model.isWorking()) {
      if (!this.unloadListener) {
        this.unloadListener = e => {
          // Ask the user for confirmation before leaving
          e.returnValue = "The import will be stopped";
        };
        console.log("added listener");
        addEventListener("beforeunload", this.unloadListener);
      }
    } else if (this.unloadListener) {
      console.log("removed listener");
      removeEventListener("beforeunload", this.unloadListener);
    }
  }
  render() {
    let {model} = this.props;
    return h("div", {},
      h("div", {id: "user-info"},
        h("a", {href: model.sfLink, className: "sf-link"},
          h("svg", {viewBox: "0 0 24 24"},
            h("path", {d: "M18.9 12.3h-1.5v6.6c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-5.1h-3.6v5.1c0 .2-.1.3-.3.3h-3c-.2 0-.3-.1-.3-.3v-6.6H5.1c-.1 0-.3-.1-.3-.2s0-.2.1-.3l6.9-7c.1-.1.3-.1.4 0l7 7v.3c0 .1-.2.2-.3.2z"})
          ),
          " Salesforce Home"
        ),
        h("h1", {}, "Daily Manager Update"),
        h("span", {}, " / " + model.userInfo),
        h("div", {className: "flex-right"},
          h("div", {id: "spinner", role: "status", className: "slds-spinner slds-spinner_small slds-spinner_inline", hidden: model.spinnerCount == 0},
            h("span", {className: "slds-assistive-text"}),
            h("div", {className: "slds-spinner__dot-a"}),
            h("div", {className: "slds-spinner__dot-b"}),
          ),
          h("a", {href: "#", id: "help-btn", title: "Import Help", onClick: this.onToggleHelpClick},
            h("div", {className: "icon"})
          ),
        ),
      ),
      h("div", {className: "conf-section"},
        h("div", {className: "conf-subsection"},
          h("div", {className: "area configure-import"},
            h("div", {className: "area-header"},
              h("h1", {}, "Playground")
            ),
            
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input"},
                h("span", {className: "conf-label"}, "Data"),
                h("span", {className: "conf-value"},
                  h("textarea", {id: "data", value: "Paste data here", onPaste: this.onDataPaste, className: model.dataError ? "confError" : "", disabled: model.isWorking(), readOnly: true, rows: 1}),
                  h("div", {className: "conf-error", hidden: !model.dataError}, model.dataError)
                )
              )
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input", title: "The number of records per batch. A higher value is faster but increases the risk of errors due to governor limits."},
                h("span", {className: "conf-label"}, "Batch size"),
                h("span", {className: "conf-value button-space"},
                  h("input", {type: "number", value: model.batchSize, onChange: this.onBatchSizeChange, className: (model.batchSizeError() ? "confError" : "") + " batch-size"}),
                  h("div", {className: "conf-error", hidden: !model.batchSizeError()}, model.batchSizeError())
                )
              ),
              h("label", {className: "conf-input", title: "The number of batches to execute concurrently. A higher number is faster but increases the risk of errors due to lock congestion."},
                h("span", {className: "conf-label"}, "Threads"),
                h("span", {className: "conf-value"},
                  h("input", {type: "number", value: model.batchConcurrency, onChange: this.onBatchConcurrencyChange, className: (model.batchConcurrencyError() ? "confError" : "") + " batch-size"}),
                  h("span", {hidden: !model.isWorking()}, model.activeBatches),
                  h("div", {className: "conf-error", hidden: !model.batchConcurrencyError()}, model.batchConcurrencyError())
                )
              )
            ),
            h("datalist", {id: "sobjectlist"}, model.sobjectList().map(data => h("option", {key: data.name, value: data.name}))),
            h("datalist", {id: "idlookuplist"}, model.idLookupList().map(data => h("option", {key: data, value: data}))),
            h("datalist", {id: "columnlist"}, model.columnList().map(data => h("option", {key: data, value: data})))
          ),
        ),
        h("div", {className: "conf-subsection columns-mapping"},
          h("div", {className: "area"},
            h("div", {className: "area-header"},
              h("h1", {}, "Field Mapping")
            ),
            /* h("div", {className: "columns-label"}, "Field mapping"), */
            model.getRequiredMissingFields().map((field, index) => h("div", {key: index, className: "conf-error confError"}, `Error: The field mapping has no '${field}' column`)),
            h("div", {className: "conf-value"}, model.columns().map((column, index) => h(ColumnMapper, {key: index, model, column})))
          )
        )
      )
    );
  }
}



{

    console.log("check zero");
    let args = new URLSearchParams(location.search.slice(1));
    let sfHost = args.get("host");
    initButton(sfHost, true);
    sfConn.getSession(sfHost).then(() => {

        let root = document.getElementById("root");
        let model = new Model(sfHost, args);
        model.reactCallback = cb => {
        ReactDOM.render(h(App, {model}), root, cb);
        };

        console.log("check two"); 

        ReactDOM.render(h(App, {model}), root);

        if (parent && parent.isUnitTest) { // for unit tests
        parent.insextTestLoaded({model});
        }

    });
}


function stringIsEmpty(str) {
  return str == null || str == undefined || str.trim() == "";
}




