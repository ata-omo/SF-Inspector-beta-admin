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
        h("h1", {}, "Data Import"),
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
              h("h1", {}, "Configure Import")
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input", title: "With the tooling API you can import more metadata, but you cannot import regular data. With the metadata API you can import custom metadata types."},
                h("span", {className: "conf-label"}, "API Type"),
                h("span", {className: "conf-value"},
                  h("select", {value: model.apiType, onChange: this.onApiTypeChange, disabled: model.isWorking()},
                    ...allApis.map((api, index) => h("option", {key: index, value: api.value}, api.label))
                  )
                )
              )
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input"},
                h("span", {className: "conf-label"}, "Action"),
                h("span", {className: "conf-value"},
                  h("select", {value: model.importAction, onChange: this.onImportActionChange, disabled: model.isWorking()},
                    ...model.availableActions.map((action, index) => h("option", {key: index, value: action.value}, action.label))
                  )
                )
              )
            ),
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input"},
                h("span", {className: "conf-label"}, "Object"),
                h("span", {className: "conf-value"},
                  h("input", {type: "search", value: model.importType, onChange: this.onImportTypeChange, className: model.importTypeError() ? "object-list confError" : "object-list", disabled: model.isWorking(), list: "sobjectlist"}),
                  h("div", {className: "conf-error", hidden: !model.importTypeError()}, model.importTypeError())
                )
              ),
              h("a", {className: "button field-info", href: model.showDescribeUrl(), target: "_blank", title: "Show field info for the selected object"},
                h("div", {className: "button-icon"}),
              )
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
            h("div", {className: "conf-line", hidden: model.importAction != "upsert"},
              h("label", {className: "conf-input", title: "Used in upserts to determine if an existing record should be updated or a new record should be created"},
                h("span", {className: "conf-label"}, "External ID:"),
                h("span", {className: "conf-value"},
                  h("input", {type: "text", value: model.externalId, onChange: this.onExternalIdChange, className: model.externalIdError() ? "confError" : "", disabled: model.isWorking(), list: "idlookuplist"}),
                  h("div", {className: "conf-error", hidden: !model.externalIdError()}, model.externalIdError())
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
            h("div", {className: "conf-line"},
              h("label", {className: "conf-input", title: "JSON Header (AllOrNoneHeader, AssignmentRuleHeader, OwnerChangeOptions ...)"},
                h("span", {className: "conf-label"}, "Custom Headers"),
                h("span", {className: "conf-value"},
                  h("input", {type: "text", placeholder: "Press ↓ for suggestions", value: model.customHeaders, onKeyDown: this.onCustomHeadersKeyPress, onChange: this.onCustomHeadersChange, className: " batch-size"}),
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
      ),
      h("div", {className: "area import-actions"},
        h("div", {className: "conf-line"},
          h("div", {className: "flex-wrapper"},
            h("button", {onClick: this.onDoImportClick, disabled: model.invalidInput() || model.isWorking() || model.importCounts().Queued == 0, className: "highlighted"}, "Run " + model.importActionName),
            h("button", {disabled: !model.isWorking(), onClick: this.onToggleProcessingClick, className: model.isWorking() && !model.isProcessingQueue ? "" : "cancel-btn"}, model.isWorking() && !model.isProcessingQueue ? "Resume Queued" : "Cancel Queued"),
            h("button", {disabled: !model.importCounts().Failed > 0, onClick: this.onRetryFailedClick}, "Retry Failed"),
            h("div", {className: "button-group"},
              h("button", {disabled: !model.canCopy(), onClick: this.onCopyAsExcelClick, title: "Copy import result to clipboard for pasting into Excel or similar"}, "Copy (Excel format)"),
              h("button", {disabled: !model.canCopy(), onClick: this.onCopyAsCsvClick, title: "Copy import result to clipboard for saving as a CSV file"}, "Copy (CSV)"),
            ),
          ),
          h("div", {className: "status-group"},
            h("div", {},
              h(StatusBox, {model, name: "Queued"}),
              h(StatusBox, {model, name: "Processing"})
            ),
            h("div", {},
              h(StatusBox, {model, name: "Succeeded"}),
              h(StatusBox, {model, name: "Failed"})
            ),
          ),
          h("div", {className: "flex-right"},
            h("button", {onClick: this.onCopyOptionsClick, title: "Save these import options by pasting them into Excel in the top left cell, just above the header row"}, "Copy Options"),
            h("button", {onClick: this.onSkipAllUnknownFieldsClick, disabled: !model.canSkipAllUnknownFields() || model.isWorking() || model.importCounts().Queued == 0}, "Skip all unknown fields")
          ),
        ),
        h("div", {hidden: !model.showHelp, className: "help-text"},
          h("h3", {}, "Import Help"),
          h("p", {}, "Use for quick one-off data imports."),
          h("ul", {},
            h("li", {}, "Enter your CSV or Excel data in the box above.",
              h("ul", {},
                h("li", {}, "The input must contain a header row with field API names."),
                h("li", {}, "To use an external ID for a lookup field, the header row should contain the lookup relation name, the target sobject name and the external ID name separated by colons, e.g. \"MyLookupField__r:MyObject__c:MyExternalIdField__c\"."),
                h("li", {}, "Empty cells insert null values."),
                h("li", {}, "Number, date, time and checkbox values must conform to the relevant ", h("a", {href: "http://www.w3.org/TR/xmlschema-2/#built-in-primitive-datatypes", target: "_blank"}, "XSD datatypes"), "."),
                h("li", {}, "Columns starting with an underscore are ignored."),
                h("li", {}, "You can resume a previous import by including the \"__Status\" column in your input."),
                h("li", {}, "You can supply the other import options by clicking \"Copy options\" and pasting the options into Excel in the top left cell, just above the header row.")
              )
            ),
            h("li", {}, "Select your input format"),
            h("li", {}, "Select an action (insert, update, upsert or delete)"),
            h("li", {}, "Enter the API name of the object to import"),
            h("li", {}, "Press the Run button")
          ),
          h("p", {}, "Bulk API is not supported. Large data volumes may freeze or crash your browser.")
        ),
      ),
      h("div", {className: "area result-area"},
        h("div", {id: "result-table", ref: "scroller"}),
        model.confirmPopup ? h("div", {},
          h("div", {id: "confirm-background"},
            h("div", {id: "confirm-dialog"},
              h("h1", {}, "Import"),
              h("p", {}, "You are about to modify your data in Salesforce. This action cannot be undone."),
              h("p", {}, model.confirmPopup.text),
              h("div", {className: "dialog-buttons"},
                h("button", {onClick: this.onConfirmPopupYesClick}, model.importActionName),
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




