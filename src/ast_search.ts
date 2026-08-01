// Implements the "ast search" feature: textDocument/ast-search.
import * as vscode from 'vscode';
import * as vscodelc from 'vscode-languageclient/node';

import { ClangdContext } from './clangd-context';
import { ASTNode, ASTSearchResult, ASTSearchParams } from '../api/vscode-clangd';
import { TreeAdapter } from './ast';

const ASTSearchRequestMethod = 'textDocument/searchAST';

const ASTSearchRequestType =
  new vscodelc.RequestType<ASTSearchParams, ASTSearchResult[], void>(ASTSearchRequestMethod);

export function activate(context: ClangdContext) {
  const feature = new ASTSearchFeature(context);
  context.client.registerFeature(feature);
}

class ASTSearchFeature implements vscodelc.StaticFeature {
  constructor(private context: ClangdContext) {
    const adapter = new ASTSearchTreeAdapter();

    const tree = vscode.window.createTreeView(
      'clangd.astSearch',
      {
        treeDataProvider: adapter,
        showCollapseAll: true,
      });

    context.subscriptions.push(
      tree,
      vscode.commands.registerCommand(
        'clangd.astSearch',
        async () => {
          await this.search(adapter);
        }),
      vscode.commands.registerCommand(
        'clangd.astSearch.close',
        () => {
          adapter.clear();
        }));

    adapter.onDidChangeTreeData(() => {
      vscode.commands.executeCommand(
        'setContext',
        'clangd.astSearch.hasData',
        !adapter.empty());
    });
  }

  private async search(adapter: ASTSearchTreeAdapter): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showInformationMessage(
        'No active editor.');
      return;
    }

    const query =
      await vscode.window.showInputBox({
        title: 'Search AST',
        prompt:
          'Enter an AST matcher expression',
        placeHolder:
          'functionDecl(hasName("foo"))',
        ignoreFocusOut: true,
      });

    if (!query)
      return;

    try {
      const converter =
        this.context.client.code2ProtocolConverter;

      const result =
        await this.context.client.sendRequest(
          ASTSearchRequestType,
          {
            textDocument: converter.asTextDocumentIdentifier(editor.document),
            query,
          });

      if (!result || result.length === 0) {
        adapter.clear();

        vscode.window.showInformationMessage(
          'No matching AST nodes found.');

        return;
      }

      adapter.setResults(
        result,
        editor.document.uri);

      vscode.commands.executeCommand(
        'setContext',
        'clangd.astSearch.hasData',
        true);
    } catch (error) {
      vscode.window.showErrorMessage(
        `AST search failed: ${error}`);
    }
  }

  fillClientCapabilities(
    _capabilities: vscodelc.ClientCapabilities) { }

  initialize(
    capabilities: vscodelc.ServerCapabilities,
    _documentSelector:
      vscodelc.DocumentSelector | undefined) {
    const supported =
      'astSearchProvider' in capabilities;

    vscode.commands.executeCommand(
      'setContext',
      'clangd.astSearch.supported',
      supported);
  }

  getState(): vscodelc.FeatureState {
    return { kind: 'static' };
  }

  clear() { }
}

class ASTSearchTreeNode {
  constructor(
    public readonly adapter: TreeAdapter,
    public readonly node: ASTNode,
    public readonly binding?: string) { }
}

class ASTSearchMatch {
  readonly nodes: ASTSearchTreeNode[];

  constructor(
    result: ASTSearchResult,
    document: vscode.Uri) {
    this.nodes = Object.entries(result).map(
      ([binding, node]) => {
        const adapter = new TreeAdapter();
        adapter.setRoot(node, document);

        return new ASTSearchTreeNode(
          adapter,
          node,
          binding);
      });
  }
}

class ASTSearchTreeAdapter
  implements vscode.TreeDataProvider<
    ASTSearchMatch | ASTSearchTreeNode> {

  private matches: ASTSearchMatch[] = [];

  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<
      ASTSearchMatch |
      ASTSearchTreeNode |
      undefined>();

  readonly onDidChangeTreeData =
    this._onDidChangeTreeData.event;

  setResults(
    results: ASTSearchResult[],
    document: vscode.Uri) {

    this.matches =
      results.map(
        result => new ASTSearchMatch(
          result,
          document));

    this._onDidChangeTreeData.fire(undefined);
  }

  clear() {
    this.matches = [];

    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(
    element:
      ASTSearchMatch |
      ASTSearchTreeNode):
    vscode.TreeItem {

    if (element instanceof ASTSearchMatch) {
      return new vscode.TreeItem(
        'Match',
        vscode.TreeItemCollapsibleState.Expanded);
    }

    const item =
      element.adapter.getTreeItem(
        element.node);

    if (element.binding) {
      item.label =
        `${element.binding}: ${item.label}`;
    }

    return item;
  }

  getChildren(
    element?:
      ASTSearchMatch |
      ASTSearchTreeNode):
    (ASTSearchMatch |
      ASTSearchTreeNode)[] {

    if (!element) {
      return this.matches;
    }

    if (element instanceof ASTSearchMatch) {
      return element.nodes;
    }

    return element.adapter
      .getChildren(element.node)
      .map(node =>
        new ASTSearchTreeNode(
          element.adapter,
          node,
          ''));
  }

  empty(): boolean {
    return this.matches.length === 0;
  }
}