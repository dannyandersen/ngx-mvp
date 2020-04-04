/**
 * Creates a new generic component definition in the given or default project.
 */
export interface Schema {
    /**
     * When true, the component will have a presenter.
     */
    presenter?: boolean;
    /**
     * When true, the declaring NgModule exports this component.
     */
    export?: boolean;
    /**
     * The declaring NgModule.
     */
    module?: string;
    /**
     * The name of the component.
     */
    name: string;
    /**
     * The path at which to create the component file, relative to the current workspace.
     * Default is a folder with the same name as the component in the project root.
     */
    path?: string;
    /**
     * The prefix to apply to the generated component selector.
     */
    prefix?: string;
    /**
     * The HTML selector to use for this component.
     */
    selector?: string;
    /**
     * The file extension or preprocessor to use for style files.
     */
    style?: Style;
    /**
     * Adds a developer-defined type to the filename, in the format "name.type.ts".
     */
    type?: string;
}
/**
 * The file extension or preprocessor to use for style files.
 */
export declare enum Style {
    Css = "css",
    Less = "less",
    Sass = "sass",
    Scss = "scss",
    Styl = "styl"
}
