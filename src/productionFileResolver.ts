import { existsSync } from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

const PRODUCTION_FILE_MAPPINGS_KEY =
  'testSmellDetector.productionFileMappings';
const EXCLUDED_SEARCH_DIRECTORIES =
  '**/{.git,node_modules,target,build,out}/**';

type ProductionFileMappings = Record<string, string>;

/** Return true when a local Java document looks like a test source file. */
export function isLikelyJavaTestDocument(
  document: vscode.TextDocument,
): boolean {
  if (document.languageId !== 'java' || document.uri.scheme !== 'file') {
    return false;
  }

  const fileName = path.basename(document.fileName);
  const normalizedPath = document.fileName.replaceAll('\\', '/').toLowerCase();

  return (
    /(?:Test|Tests|IT|Spec)\.java$/i.test(fileName) ||
    normalizedPath.includes('/src/test/')
  );
}

/**
 * Locate and remember the production source paired with a Java test file.
 * Automatic analysis never opens a picker; a manual run can ask the user when
 * convention-based matching is not enough.
 */
export class ProductionFileResolver {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolve(
    document: vscode.TextDocument,
    interactive: boolean,
  ): Promise<string | undefined> {
    const rememberedPath = await this.getRememberedPath(document);
    if (rememberedPath) {
      return rememberedPath;
    }

    const automaticPath = await this.findAutomaticMatch(document);
    if (automaticPath) {
      await this.remember(document, automaticPath);
      return automaticPath;
    }

    if (!interactive) {
      return undefined;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const selectedFiles = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri:
        workspaceFolder?.uri ?? vscode.Uri.file(path.dirname(document.fileName)),
      filters: {
        'Java source files': ['java'],
      },
      openLabel: 'Use as production file',
      title: `Select the production file tested by ${path.basename(document.fileName)}`,
    });

    const selectedPath = selectedFiles?.[0]?.fsPath;
    if (!selectedPath) {
      return undefined;
    }

    if (sameFile(selectedPath, document.fileName)) {
      await vscode.window.showWarningMessage(
        'Choose the production Java file, not the test file itself.',
      );
      return undefined;
    }

    await this.remember(document, selectedPath);
    return selectedPath;
  }

  private async getRememberedPath(
    document: vscode.TextDocument,
  ): Promise<string | undefined> {
    const mappings = this.context.workspaceState.get<ProductionFileMappings>(
      PRODUCTION_FILE_MAPPINGS_KEY,
      {},
    );
    const rememberedPath = mappings[document.uri.toString()];

    if (
      rememberedPath &&
      existsSync(rememberedPath) &&
      !sameFile(rememberedPath, document.fileName)
    ) {
      return rememberedPath;
    }

    if (rememberedPath) {
      const updatedMappings = { ...mappings };
      delete updatedMappings[document.uri.toString()];
      await this.context.workspaceState.update(
        PRODUCTION_FILE_MAPPINGS_KEY,
        updatedMappings,
      );
    }

    return undefined;
  }

  private async findAutomaticMatch(
    document: vscode.TextDocument,
  ): Promise<string | undefined> {
    const productionFileName = getProductionFileName(document.fileName);
    const conventionalPath = getConventionalProductionPath(
      document.fileName,
      productionFileName,
    );

    if (
      conventionalPath &&
      existsSync(conventionalPath) &&
      !sameFile(conventionalPath, document.fileName)
    ) {
      return conventionalPath;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return undefined;
    }

    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder, `**/${productionFileName}`),
      EXCLUDED_SEARCH_DIRECTORIES,
      50,
    );
    const candidates = matches.filter(
      (candidate) => !sameFile(candidate.fsPath, document.fileName),
    );

    // Prefer normal Maven/Gradle production roots, then the shortest path.
    candidates.sort((first, second) => {
      const firstInMain = isMainSourcePath(first.fsPath);
      const secondInMain = isMainSourcePath(second.fsPath);
      if (firstInMain !== secondInMain) {
        return firstInMain ? -1 : 1;
      }
      return first.fsPath.length - second.fsPath.length;
    });

    return candidates[0]?.fsPath;
  }

  private async remember(
    document: vscode.TextDocument,
    productionFilePath: string,
  ): Promise<void> {
    const mappings = this.context.workspaceState.get<ProductionFileMappings>(
      PRODUCTION_FILE_MAPPINGS_KEY,
      {},
    );

    await this.context.workspaceState.update(PRODUCTION_FILE_MAPPINGS_KEY, {
      ...mappings,
      [document.uri.toString()]: productionFilePath,
    });
  }
}

function getProductionFileName(testFilePath: string): string {
  return path
    .basename(testFilePath)
    .replace(/(?:Tests|Test|IT|Spec)\.java$/i, '.java');
}

function getConventionalProductionPath(
  testFilePath: string,
  productionFileName: string,
): string | undefined {
  const pathParts = path.normalize(testFilePath).split(path.sep);

  for (let index = 0; index <= pathParts.length - 3; index += 1) {
    if (
      pathParts[index] === 'src' &&
      pathParts[index + 1] === 'test' &&
      pathParts[index + 2] === 'java'
    ) {
      const productionParts = [...pathParts];
      productionParts[index + 1] = 'main';
      productionParts[productionParts.length - 1] = productionFileName;
      return productionParts.join(path.sep);
    }
  }

  return undefined;
}

function isMainSourcePath(filePath: string): boolean {
  return filePath
    .replaceAll('\\', '/')
    .toLowerCase()
    .includes('/src/main/');
}

function sameFile(firstPath: string, secondPath: string): boolean {
  return path.resolve(firstPath) === path.resolve(secondPath);
}
