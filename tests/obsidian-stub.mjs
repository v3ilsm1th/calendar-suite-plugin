// Minimal stand-in for the `obsidian` module so the pure logic can be tested
// in plain Node. Only the pieces the tested modules import at runtime are
// provided – everything else is a type-only import and disappears during
// bundling.
export class App {}
export class Vault {}
export class MarkdownView {}
export class Component {}
export class MarkdownRenderChild extends Component {
    constructor(containerEl) {
        super();
        this.containerEl = containerEl;
    }
}
export class Plugin extends Component {}
export class PluginSettingTab {
    constructor() {}
    display() {}
    hide() {}
}
export class Setting {
    setName() { return this; }
    setDesc() { return this; }
    addText() { return this; }
    addToggle() { return this; }
    addDropdown() { return this; }
    addButton() { return this; }
}
export class TFile {}
export class TFolder {}
export class Notice {
    constructor(message) {
        this.message = message;
    }
}
export default {};
