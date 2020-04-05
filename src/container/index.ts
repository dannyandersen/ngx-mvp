import { Rule, SchematicContext, Tree, chain, mergeWith, apply, applyTemplates, move, url, SchematicsException, filter, noop } from '@angular-devkit/schematics';

import { Schema } from './schema';
import { strings } from '@angular-devkit/core';
import { getWorkspace, parseName, buildDefaultPath, buildRelativePath, addDeclarationToModule, InsertChange, addExportToModule, findModuleFromOptions } from '../helpers/helpers';
import { dasherize } from '@angular-devkit/core/src/utils/strings';
import * as ts from '../third_party/github.com/Microsoft/TypeScript/lib/typescript';


function readIntoSourceFile(host: Tree, modulePath: string): ts.SourceFile {
    const text = host.read(modulePath);
    if (text === null) {
        throw new SchematicsException(`File ${modulePath} does not exist.`);
    }
    const sourceText = text.toString('utf-8');

    return ts.createSourceFile(modulePath, sourceText, ts.ScriptTarget.Latest, true);
}


function addDeclarationToNgModule(options: Schema, type?: string): Rule {
    return (host: Tree) => {
        
        type = !type ? 'Component' : type;
        
        const modulePath = options.module as string;
        const source = readIntoSourceFile(host, modulePath);
        
        const componentPath = `/${options.path}/`
            + strings.dasherize(options.name) + '/'
            + strings.dasherize(options.name)
            + (options.type ? '.' : '')
            + (type === 'ContainerComponent' ? 'container' : strings.dasherize(type));
        const relativePath = buildRelativePath(modulePath, componentPath);
        const classifiedName = strings.classify(options.name) + strings.classify(type);
        const declarationChanges = addDeclarationToModule(
            source,
            modulePath,
            classifiedName,
            relativePath);

        const declarationRecorder = host.beginUpdate(modulePath);
        for (const change of declarationChanges) {
            if (change instanceof InsertChange) {
                declarationRecorder.insertLeft(change.pos, change.toAdd);
            }
        }
        host.commitUpdate(declarationRecorder);

        if (options.export) {
            // Need to refresh the AST because we overwrote the file in the host.
            const source = readIntoSourceFile(host, modulePath);

            const exportRecorder = host.beginUpdate(modulePath);
            const exportChanges = addExportToModule(source, modulePath,
                strings.classify(options.name) + strings.classify(type),
                relativePath);

            for (const change of exportChanges) {
                if (change instanceof InsertChange) {
                    exportRecorder.insertLeft(change.pos, change.toAdd);
                }
            }
            host.commitUpdate(exportRecorder);
        }

        return host;

    };
}

export default function (options: Schema): Rule {
    return (host: Tree, _context: SchematicContext) => {

        const workspace = getWorkspace(host);
        const project = workspace.defaultProject as string;

        if (options.path === undefined && project) {
            options.path = buildDefaultPath(workspace.projects[project]);
        }
        options.module = findModuleFromOptions(host, options);
        const parsedPath = parseName(options.path as string, options.name);
        options.name = parsedPath.name;
        options.path = parsedPath.path;

        const prefix = workspace.projects[project].prefix;
        options.selector = `${prefix}-${dasherize(options.name)}`

        const templateSource = apply(url('./files'), [
            !options.presenter ? filter(path => !path.endsWith('.presenter.ts.template')) : noop(),
            applyTemplates({
                ...strings,
                ...options,
            }),
            move(parsedPath.path),
        ]);

        return chain([
            addDeclarationToNgModule(options, 'ContainerComponent'),
            addDeclarationToNgModule(options),
            mergeWith(templateSource),
        ]);
    };
}
