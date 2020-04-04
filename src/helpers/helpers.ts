import { Tree, SchematicsException, DirEntry } from "@angular-devkit/schematics";
import { WorkspaceSchema, WorkspaceProject } from "@angular-devkit/core/src/experimental/workspace";
import { JsonParseMode, parseJson, basename, normalize, Path, dirname, join, relative, NormalizedRoot } from "@angular-devkit/core";
import * as ts from '../third_party/github.com/Microsoft/TypeScript/lib/typescript';

interface Location {
    name: string;
    path: Path;
}

export interface Host {
    write(path: string, content: string): Promise<void>;
    read(path: string): Promise<string>;
}

export interface ModuleOptions {
    module?: string;
    name: string;
    flat?: boolean;
    path?: string;
    skipImport?: boolean;
    moduleExt?: string;
    routingModuleExt?: string;
}

export const MODULE_EXT = '.module.ts';
export const ROUTING_MODULE_EXT = '-routing.module.ts';

export interface Change {
    apply(host: Host): Promise<void>;

    // The file this change should be applied to. Some changes might not apply to
    // a file (maybe the config).
    readonly path: string | null;

    // The order this change should be applied. Normally the position inside the file.
    // Changes are applied from the bottom of a file to the top.
    readonly order: number;

    // The description of this change. This will be outputted in a dry or verbose run.
    readonly description: string;
}

/**
 * An operation that does nothing.
 */
export class NoopChange implements Change {
    description = 'No operation.';
    order = Infinity;
    path = null;
    apply() { return Promise.resolve(); }
}


/**
 * Will add text to the source code.
 */
export class InsertChange implements Change {

    order: number;
    description: string;

    constructor(public path: string, public pos: number, public toAdd: string) {
        if (pos < 0) {
            throw new Error('Negative positions are invalid');
        }
        this.description = `Inserted ${toAdd} into position ${pos} of ${path}`;
        this.order = pos;
    }

    /**
     * This method does not insert spaces if there is none in the original string.
     */
    apply(host: Host) {
        return host.read(this.path).then(content => {
            const prefix = content.substring(0, this.pos);
            const suffix = content.substring(this.pos);

            return host.write(this.path, `${prefix}${this.toAdd}${suffix}`);
        });
    }
}

export function insertImport(source: ts.SourceFile, fileToEdit: string, symbolName: string,
    fileName: string, isDefault = false): Change {
    const rootNode = source;
    const allImports = findNodes(rootNode, ts.SyntaxKind.ImportDeclaration);

    // get nodes that map to import statements from the file fileName
    const relevantImports = allImports.filter(node => {
        // StringLiteral of the ImportDeclaration is the import file (fileName in this case).
        const importFiles = node.getChildren()
            .filter(child => child.kind === ts.SyntaxKind.StringLiteral)
            .map(n => (n as ts.StringLiteral).text);

        return importFiles.filter(file => file === fileName).length === 1;
    });

    if (relevantImports.length > 0) {
        let importsAsterisk = false;
        // imports from import file
        const imports: ts.Node[] = [];
        relevantImports.forEach(n => {
            Array.prototype.push.apply(imports, findNodes(n, ts.SyntaxKind.Identifier));
            if (findNodes(n, ts.SyntaxKind.AsteriskToken).length > 0) {
                importsAsterisk = true;
            }
        });

        // if imports * from fileName, don't add symbolName
        if (importsAsterisk) {
            return new NoopChange();
        }

        const importTextNodes = imports.filter(n => (n as ts.Identifier).text === symbolName);

        // insert import if it's not there
        if (importTextNodes.length === 0) {
            const fallbackPos =
                findNodes(relevantImports[0], ts.SyntaxKind.CloseBraceToken)[0].getStart() ||
                findNodes(relevantImports[0], ts.SyntaxKind.FromKeyword)[0].getStart();

            return insertAfterLastOccurrence(imports, `, ${symbolName}`, fileToEdit, fallbackPos);
        }

        return new NoopChange();
    }

    // no such import declaration exists
    const useStrict = findNodes(rootNode, ts.SyntaxKind.StringLiteral)
        .filter((n: ts.StringLiteral) => n.text === 'use strict');
    let fallbackPos = 0;
    if (useStrict.length > 0) {
        fallbackPos = useStrict[0].end;
    }
    const open = isDefault ? '' : '{ ';
    const close = isDefault ? '' : ' }';
    // if there are no imports or 'use strict' statement, insert import at beginning of file
    const insertAtBeginning = allImports.length === 0 && useStrict.length === 0;
    const separator = insertAtBeginning ? '' : ';\n';
    const toInsert = `${separator}import ${open}${symbolName}${close}` +
        ` from '${fileName}'${insertAtBeginning ? ';\n' : ''}`;

    return insertAfterLastOccurrence(
        allImports,
        toInsert,
        fileToEdit,
        fallbackPos,
        ts.SyntaxKind.StringLiteral,
    );
}

function getWorkspacePath(host: Tree): string {
    const possibleFiles = ['/angular.json', '/.angular.json'];
    const path = possibleFiles.filter(path => host.exists(path))[0];

    return path;
}

export function getWorkspace(host: Tree): WorkspaceSchema {
    const path = getWorkspacePath(host);
    const configBuffer = host.read(path);
    if (configBuffer === null) {
        throw new SchematicsException(`Could not find (${path})`);
    }
    const content = configBuffer.toString();

    return parseJson(content, JsonParseMode.Loose) as {} as WorkspaceSchema;
}

export function buildDefaultPath(project: WorkspaceProject): string {
    const root = project.sourceRoot ? `/${project.sourceRoot}/` : `/${project.root}/src/`;
    const projectDirName = project.projectType === 'application' ? 'app' : 'lib';

    return `${root}${projectDirName}`;
}

export function parseName(path: string, name: string): Location {
    const nameWithoutPath = basename(normalize(name));
    const namePath = dirname(join(normalize(path), name) as Path);

    return {
        name: nameWithoutPath,
        path: normalize('/' + namePath),
    };
}

export function buildRelativePath(from: string, to: string): string {
    from = normalize(from);
    to = normalize(to);

    // Convert to arrays.
    const fromParts = from.split('/');
    const toParts = to.split('/');

    // Remove file names (preserving destination)
    fromParts.pop();
    const toFileName = toParts.pop();

    const relativePath = relative(normalize(fromParts.join('/') || '/'),
        normalize(toParts.join('/') || '/'));
    let pathPrefix = '';

    // Set the path prefix for same dir or child dir, parent dir starts with `..`
    if (!relativePath) {
        pathPrefix = '.';
    } else if (!relativePath.startsWith('.')) {
        pathPrefix = `./`;
    }
    if (pathPrefix && !pathPrefix.endsWith('/')) {
        pathPrefix += '/';
    }

    return pathPrefix + (relativePath ? relativePath + '/' : '') + toFileName;
}

/**
* Custom function to insert a declaration (component, pipe, directive)
* into NgModule declarations. It also imports the component.
*/
export function addDeclarationToModule(source: ts.SourceFile,
    modulePath: string, classifiedName: string,
    importPath: string): Change[] {
    return addSymbolToNgModuleMetadata(
        source, modulePath, 'declarations', classifiedName, importPath);
}

export function addSymbolToNgModuleMetadata(
    source: ts.SourceFile,
    ngModulePath: string,
    metadataField: string,
    symbolName: string,
    importPath: string | null = null,
): Change[] {
    const nodes = getDecoratorMetadata(source, 'NgModule', '@angular/core');
    let node: any = nodes[0];  // tslint:disable-line:no-any

    // Find the decorator declaration.
    if (!node) {
        return [];
    }

    // Get all the children property assignment of object literals.
    const matchingProperties = getMetadataField(
        node as ts.ObjectLiteralExpression,
        metadataField,
    );

    // Get the last node of the array literal.
    if (!matchingProperties) {
        return [];
    }
    if (matchingProperties.length == 0) {
        // We haven't found the field in the metadata declaration. Insert a new field.
        const expr = node as ts.ObjectLiteralExpression;
        let position: number;
        let toInsert: string;
        if (expr.properties.length == 0) {
            position = expr.getEnd() - 1;
            toInsert = `  ${metadataField}: [${symbolName}]\n`;
        } else {
            node = expr.properties[expr.properties.length - 1];
            position = node.getEnd();
            // Get the indentation of the last element, if any.
            const text = node.getFullText(source);
            const matches = text.match(/^\r?\n\s*/);
            if (matches && matches.length > 0) {
                toInsert = `,${matches[0]}${metadataField}: [${symbolName}]`;
            } else {
                toInsert = `, ${metadataField}: [${symbolName}]`;
            }
        }
        if (importPath !== null) {
            return [
                new InsertChange(ngModulePath, position, toInsert),
                insertImport(source, ngModulePath, symbolName.replace(/\..*$/, ''), importPath),
            ];
        } else {
            return [new InsertChange(ngModulePath, position, toInsert)];
        }
    }
    const assignment = matchingProperties[0] as ts.PropertyAssignment;

    // If it's not an array, nothing we can do really.
    if (assignment.initializer.kind !== ts.SyntaxKind.ArrayLiteralExpression) {
        return [];
    }

    const arrLiteral = assignment.initializer as ts.ArrayLiteralExpression;
    if (arrLiteral.elements.length == 0) {
        // Forward the property.
        node = arrLiteral;
    } else {
        node = arrLiteral.elements;
    }

    if (!node) {
        // tslint:disable-next-line: no-console
        console.error('No app module found. Please add your new class to your component.');

        return [];
    }

    if (Array.isArray(node)) {
        const nodeArray = node as {} as Array<ts.Node>;
        const symbolsArray = nodeArray.map(node => node.getText());
        if (symbolsArray.includes(symbolName)) {
            return [];
        }

        node = node[node.length - 1];
    }

    let toInsert: string;
    let position = node.getEnd();
    if (node.kind == ts.SyntaxKind.ObjectLiteralExpression) {
        // We haven't found the field in the metadata declaration. Insert a new
        // field.
        const expr = node as ts.ObjectLiteralExpression;
        if (expr.properties.length == 0) {
            position = expr.getEnd() - 1;
            toInsert = `  ${symbolName}\n`;
        } else {
            // Get the indentation of the last element, if any.
            const text = node.getFullText(source);
            if (text.match(/^\r?\r?\n/)) {
                toInsert = `,${text.match(/^\r?\n\s*/)[0]}${symbolName}`;
            } else {
                toInsert = `, ${symbolName}`;
            }
        }
    } else if (node.kind == ts.SyntaxKind.ArrayLiteralExpression) {
        // We found the field but it's empty. Insert it just before the `]`.
        position--;
        toInsert = `${symbolName}`;
    } else {
        // Get the indentation of the last element, if any.
        const text = node.getFullText(source);
        if (text.match(/^\r?\n/)) {
            toInsert = `,${text.match(/^\r?\n(\r?)\s*/)[0]}${symbolName}`;
        } else {
            toInsert = `, ${symbolName}`;
        }
    }
    if (importPath !== null) {
        return [
            new InsertChange(ngModulePath, position, toInsert),
            insertImport(source, ngModulePath, symbolName.replace(/\..*$/, ''), importPath),
        ];
    }

    return [new InsertChange(ngModulePath, position, toInsert)];
}

export function getDecoratorMetadata(source: ts.SourceFile, identifier: string,
    module: string): ts.Node[] {
    const angularImports: { [name: string]: string }
        = findNodes(source, ts.SyntaxKind.ImportDeclaration)
            .map((node: ts.ImportDeclaration) => _angularImportsFromNode(node, source))
            .reduce((acc: { [name: string]: string }, current: { [name: string]: string }) => {
                for (const key of Object.keys(current)) {
                    acc[key] = current[key];
                }

                return acc;
            }, {});

    return getSourceNodes(source)
        .filter(node => {
            return node.kind == ts.SyntaxKind.Decorator
                && (node as ts.Decorator).expression.kind == ts.SyntaxKind.CallExpression;
        })
        .map(node => (node as ts.Decorator).expression as ts.CallExpression)
        .filter(expr => {
            if (expr.expression.kind == ts.SyntaxKind.Identifier) {
                const id = expr.expression as ts.Identifier;

                return id.text == identifier && angularImports[id.text] === module;
            } else if (expr.expression.kind == ts.SyntaxKind.PropertyAccessExpression) {
                // This covers foo.NgModule when importing * as foo.
                const paExpr = expr.expression as ts.PropertyAccessExpression;
                // If the left expression is not an identifier, just give up at that point.
                if (paExpr.expression.kind !== ts.SyntaxKind.Identifier) {
                    return false;
                }

                const id = paExpr.name.text;
                const moduleId = (paExpr.expression as ts.Identifier).text;

                return id === identifier && (angularImports[moduleId + '.'] === module);
            }

            return false;
        })
        .filter(expr => expr.arguments[0]
            && expr.arguments[0].kind == ts.SyntaxKind.ObjectLiteralExpression)
        .map(expr => expr.arguments[0] as ts.ObjectLiteralExpression);
}

export function getMetadataField(
    node: ts.ObjectLiteralExpression,
    metadataField: string,
): ts.ObjectLiteralElement[] {
    return node.properties
        .filter(prop => ts.isPropertyAssignment(prop))
        // Filter out every fields that's not "metadataField". Also handles string literals
        // (but not expressions).
        .filter(({ name }: ts.PropertyAssignment) => {
            return (ts.isIdentifier(name) || ts.isStringLiteral(name))
                && name.getText() === metadataField;
        });
}


/**
 * Find all nodes from the AST in the subtree of node of SyntaxKind kind.
 * @param node
 * @param kind
 * @param max The maximum number of items to return.
 * @param recursive Continue looking for nodes of kind recursive until end
 * the last child even when node of kind has been found.
 * @return all nodes of kind, or [] if none is found
 */
export function findNodes(node: ts.Node, kind: ts.SyntaxKind, max = Infinity, recursive = false): ts.Node[] {
    if (!node || max == 0) {
        return [];
    }

    const arr: ts.Node[] = [];
    if (node.kind === kind) {
        arr.push(node);
        max--;
    }
    if (max > 0 && (recursive || node.kind !== kind)) {
        for (const child of node.getChildren()) {
            findNodes(child, kind, max).forEach(node => {
                if (max > 0) {
                    arr.push(node);
                }
                max--;
            });

            if (max <= 0) {
                break;
            }
        }
    }

    return arr;
}

/**
 * Insert `toInsert` after the last occurence of `ts.SyntaxKind[nodes[i].kind]`
 * or after the last of occurence of `syntaxKind` if the last occurence is a sub child
 * of ts.SyntaxKind[nodes[i].kind] and save the changes in file.
 *
 * @param nodes insert after the last occurence of nodes
 * @param toInsert string to insert
 * @param file file to insert changes into
 * @param fallbackPos position to insert if toInsert happens to be the first occurence
 * @param syntaxKind the ts.SyntaxKind of the subchildren to insert after
 * @return Change instance
 * @throw Error if toInsert is first occurence but fall back is not set
 */
export function insertAfterLastOccurrence(nodes: ts.Node[],
    toInsert: string,
    file: string,
    fallbackPos: number,
    syntaxKind?: ts.SyntaxKind): Change {
    let lastItem: ts.Node | undefined;
    for (const node of nodes) {
        if (!lastItem || lastItem.getStart() < node.getStart()) {
            lastItem = node;
        }
    }
    if (syntaxKind && lastItem) {
        lastItem = findNodes(lastItem, syntaxKind).sort(nodesByPosition).pop();
    }
    if (!lastItem && fallbackPos == undefined) {
        throw new Error(`tried to insert ${toInsert} as first occurence with no fallback position`);
    }
    const lastItemPosition: number = lastItem ? lastItem.getEnd() : fallbackPos;

    return new InsertChange(file, lastItemPosition, toInsert);
}


/**
 * Get all the nodes from a source.
 * @param sourceFile The source file object.
 * @returns {Observable<ts.Node>} An observable of all the nodes in the source.
 */
export function getSourceNodes(sourceFile: ts.SourceFile): ts.Node[] {
    const nodes: ts.Node[] = [sourceFile];
    const result = [];

    while (nodes.length > 0) {
        const node = nodes.shift();

        if (node) {
            result.push(node);
            if (node.getChildCount(sourceFile) >= 0) {
                nodes.unshift(...node.getChildren());
            }
        }
    }

    return result;
}

function _angularImportsFromNode(node: ts.ImportDeclaration,
    _sourceFile: ts.SourceFile): { [name: string]: string } {
    const ms = node.moduleSpecifier;
    let modulePath: string;
    switch (ms.kind) {
        case ts.SyntaxKind.StringLiteral:
            modulePath = (ms as ts.StringLiteral).text;
            break;
        default:
            return {};
    }

    if (!modulePath.startsWith('@angular/')) {
        return {};
    }

    if (node.importClause) {
        if (node.importClause.name) {
            // This is of the form `import Name from 'path'`. Ignore.
            return {};
        } else if (node.importClause.namedBindings) {
            const nb = node.importClause.namedBindings;
            if (nb.kind == ts.SyntaxKind.NamespaceImport) {
                // This is of the form `import * as name from 'path'`. Return `name.`.
                return {
                    [(nb as ts.NamespaceImport).name.text + '.']: modulePath,
                };
            } else {
                // This is of the form `import {a,b,c} from 'path'`
                const namedImports = nb as ts.NamedImports;

                return namedImports.elements
                    .map((is: ts.ImportSpecifier) => is.propertyName ? is.propertyName.text : is.name.text)
                    .reduce((acc: { [name: string]: string }, curr: string) => {
                        acc[curr] = modulePath;

                        return acc;
                    }, {});
            }
        }

        return {};
    } else {
        // This is of the form `import 'path';`. Nothing to do.
        return {};
    }
}


/**
 * Helper for sorting nodes.
 * @return function to sort nodes in increasing order of position in sourceFile
 */
function nodesByPosition(first: ts.Node, second: ts.Node): number {
    return first.getStart() - second.getStart();
}

/**
 * Custom function to insert an export into NgModule. It also imports it.
 */
export function addExportToModule(source: ts.SourceFile,
    modulePath: string, classifiedName: string,
    importPath: string): Change[] {
    return addSymbolToNgModuleMetadata(source, modulePath, 'exports', classifiedName, importPath);
}

/**
 * Find the module referred by a set of options passed to the schematics.
 */
export function findModuleFromOptions(host: Tree, options: ModuleOptions): Path | undefined {
    if (options.hasOwnProperty('skipImport') && options.skipImport) {
        return undefined;
    }

    const moduleExt = options.moduleExt || MODULE_EXT;
    const routingModuleExt = options.routingModuleExt || ROUTING_MODULE_EXT;

    if (!options.module) {
        const pathToCheck = (options.path || '') + '/' + options.name;

        return normalize(findModule(host, pathToCheck, moduleExt, routingModuleExt));
    } else {
        const modulePath = normalize(`/${options.path}/${options.module}`);
        const componentPath = normalize(`/${options.path}/${options.name}`);
        const moduleBaseName = normalize(modulePath).split('/').pop();

        const candidateSet = new Set<Path>([
            normalize(options.path || '/'),
        ]);

        for (let dir = modulePath; dir != NormalizedRoot; dir = dirname(dir)) {
            candidateSet.add(dir);
        }
        for (let dir = componentPath; dir != NormalizedRoot; dir = dirname(dir)) {
            candidateSet.add(dir);
        }

        const candidatesDirs = [...candidateSet].sort((a, b) => b.length - a.length);
        for (const c of candidatesDirs) {
            const candidateFiles = [
                '',
                `${moduleBaseName}.ts`,
                `${moduleBaseName}${moduleExt}`,
            ].map(x => join(c, x));

            for (const sc of candidateFiles) {
                if (host.exists(sc)) {
                    return normalize(sc);
                }
            }
        }

        throw new Error(
            `Specified module '${options.module}' does not exist.\n`
            + `Looked in the following directories:\n    ${candidatesDirs.join('\n    ')}`,
        );
    }
}

/**
 * Function to find the "closest" module to a generated file's path.
 */
export function findModule(host: Tree, generateDir: string,
    moduleExt = MODULE_EXT, routingModuleExt = ROUTING_MODULE_EXT): Path {

    let dir: DirEntry | null = host.getDir('/' + generateDir);
    let foundRoutingModule = false;

    while (dir) {
        const allMatches = dir.subfiles.filter(p => p.endsWith(moduleExt));
        const filteredMatches = allMatches.filter(p => !p.endsWith(routingModuleExt));

        foundRoutingModule = foundRoutingModule || allMatches.length !== filteredMatches.length;

        if (filteredMatches.length == 1) {
            return join(dir.path, filteredMatches[0]);
        } else if (filteredMatches.length > 1) {
            throw new Error('More than one module matches. Use skip-import option to skip importing '
                + 'the component into the closest module.');
        }

        dir = dir.parent;
    }

    const errorMsg = foundRoutingModule ? 'Could not find a non Routing NgModule.'
        + `\nModules with suffix '${routingModuleExt}' are strictly reserved for routing.`
        + '\nUse the skip-import option to skip importing in NgModule.'
        : 'Could not find an NgModule. Use the skip-import option to skip importing in NgModule.';

    throw new Error(errorMsg);
}
