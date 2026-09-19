/* global React ReactDOM */
import { sfConn, apiVersion } from "./inspector.js";
/* global initButton */

let h = React.createElement;

const allAdminTasks = [
  {
    id: "manager-update",
    label: "Manager Update",
    description: "Update the Manager to align with Workday",
    primaryObject: "User",
    requiredReports: ["CR - All Active Workers - General Info"]
  },
  {
    id: "leaders-update",
    label: "Leaders Update",
    description: "Update L1,L2,L3 on Resource record to align with Workday",
    primaryObject: "KimbleOne__Resource__c",
    requiredReports: ["INT211 Kimble - Full Headcount for Kimble Admin"]
  }
];

class Model {

  constructor(sfHost, args) {

    this.sfHost = sfHost;
    this.args = args;

    this.sfLink = "https://" + sfHost;

    this.userInfo = "...";

    this.spinnerCount = 0;

    this.showHelp = false;

    // this.selectedTask = null;

    this.tasks = allAdminTasks;

    this.uploadedFile = null;
    this.validationResult = null;
    this.processing = false;

    this.spinFor(
      sfConn
        .soap(
          sfConn.wsdl(apiVersion, "Partner"),
          "getUserInfo",
          {}
        )
        .then(res => {

          this.userInfo =
              res.userFullName +
              " / " +
              res.userName +
              " / " +
              res.organizationName;

        })
    );
  }

  didUpdate(cb) {

    if (this.reactCallback) {
      this.reactCallback(cb);
    }

    if (this.testCallback) {
      this.testCallback();
    }
  }

  spinFor(promise) {

    this.spinnerCount++;

    promise
      .catch(err => {
        console.error(err);
      })
      .then(() => {
        this.spinnerCount--;
        this.didUpdate();
      })
      .catch(err => {
        console.error(err);
      });
  }

  // selectTask(taskId) {

  //   this.selectedTask =
  //       this.tasks.find(t => t.id === taskId);

  //   this.didUpdate();
  // }


  selectTask(taskId) {
    const task = this.tasks.find(t => t.id === taskId);

    if (!task) {
      console.error("Admin task not found:", taskId);
      return;
    }

    const pageUrl =
      task.id +
      ".html?" +
      this.args.toString();

    // window.location.href = pageUrl;
    window.location.assign(pageUrl);
  }

  // clearTask() {

  //   // this.selectedTask = null;

  //   this.didUpdate();
  // }

}

class App extends React.Component {

  constructor(props) {

    super(props);

    this.onTaskSelect =
        this.onTaskSelect.bind(this);

    this.onBackClick =
        this.onBackClick.bind(this);

    this.onToggleHelpClick =
        this.onToggleHelpClick.bind(this);
  }

  onTaskSelect(taskId) {

    let { model } = this.props;

    model.selectTask(taskId);
  }

  onBackClick(e) {

    e.preventDefault();

    let { model } = this.props;

    model.clearTask();
  }

  onToggleHelpClick(e) {

    e.preventDefault();

    let { model } = this.props;

    model.showHelp = !model.showHelp;

    model.didUpdate();
  }

  renderTaskList(model) {

    return h(
      "div",
      { className: "conf-section" },

      ...model.tasks.map(task =>
        h(
          "div",
          {
            key: task.id,
            className: "area"
          },

          h(
            "div",
            { className: "area-header" },
            h("h1", {}, task.label)
          ),

          h(
            "div",
            { style: { padding: "10px" } },

            h("p", {}, task.description),

            h(
              "button",
              {
                className: "highlighted",
                onClick: () =>
                  this.onTaskSelect(task.id)
              },
              "Select"
            )
          )
        )
      )
    );
  }

  // renderTaskDetails(model) {

  //   let task = model.selectedTask;

  //   return h(
  //     "div",
  //     { className: "area" },

  //     h(
  //       "div",
  //       { className: "area-header" },
  //       h("h1", {}, task.label)
  //     ),

  //     h(
  //       "div",
  //       { style: { padding: "15px" } },

  //       h(
  //         "p",
  //         {},
  //         task.description
  //       ),

  //       h(
  //         "h3",
  //         {},
  //         "Primary Object"
  //       ),

  //       h(
  //         "p",
  //         {},
  //         task.primaryObject
  //       ),

  //       h(
  //         "h3",
  //         {},
  //         "Required Files"
  //       ),

  //       h(
  //         "ul",
  //         {},
  //         ...task.requiredFiles.map(
  //           file =>
  //             h(
  //               "li",
  //               { key: file },
  //               file
  //             )
  //         )
  //       ),

  //       h(
  //         "br"
  //       ),

  //       h(
  //         "button",
  //         {
  //           onClick: this.onBackClick
  //         },
  //         "Back"
  //       ),

  //       " ",

  //       h(
  //         "button",
  //         {
  //           disabled: true,
  //           className: "highlighted"
  //         },
  //         "Continue"
  //       )
  //     )
  //   );
  // }

  render() {

    let { model } = this.props;

    return h(
      "div",
      {},

      h(
        "div",
        { id: "user-info" },

        h(
          "a",
          {
            href: model.sfLink,
            className: "sf-link"
          },
          "Salesforce Home"
        ),

        h(
          "h1",
          {},
          "Admin Tasks"
        ),

        h(
          "span",
          {},
          " / " + model.userInfo
        ),

        h(
          "div",
          { className: "flex-right" },

          h(
            "div",
            {
              id: "spinner",
              hidden:
                model.spinnerCount === 0
            },
            "Loading..."
          ),

          h(
            "a",
            {
              href: "#",
              id: "help-btn",
              onClick:
                this.onToggleHelpClick
            },
            "?"
          )
        )
      ),

      // model.selectedTask
      //   ? this.renderTaskDetails(model)
      //   : this.renderTaskList(model),
      this.renderTaskList(model),

      h(
        "div",
        {
          hidden:
            !model.showHelp,
          className: "help-text"
        },

        h(
          "h3",
          {},
          "Admin Tasks"
        ),

        h(
          "p",
          {},
          "Select an admin task to begin."
        ),

        h(
          "ul",
          {},

          h(
            "li",
            {},
            "Choose an Admin Task"
          ),

          h(
            "li",
            {},
            "Review required files"
          ),

          h(
            "li",
            {},
            "Upload files (coming next phase)"
          ),

          h(
            "li",
            {},
            "Validate data (future phase)"
          ),

          h(
            "li",
            {},
            "Update Salesforce (future phase)"
          )
        )
      )
    );
  }
}

{
  let args =
    new URLSearchParams(
      location.search.slice(1)
    );

  let sfHost =
    args.get("host");

  initButton(sfHost, true);

  sfConn
    .getSession(sfHost)
    .then(() => {

      let root =
        document.getElementById("root");

      let model =
        new Model(sfHost, args);

      model.reactCallback = cb => {

        ReactDOM.render(
          h(App, { model }),
          root,
          cb
        );

      };

      ReactDOM.render(
        h(App, { model }),
        root
      );

      
      if (window.parent && window.parent.isUnitTest) { // for unit tests
        window.parent.insextTestLoaded({model});
      }

    })
    .catch(err => {
      console.error("Failed to initialize Admin Tasks:",err);
    });
}