import fs from 'fs';
import path from 'path';
import { SystemConfig, AnalysisObject } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const SYSTEMS_DIR = path.join(DATA_DIR, 'systems');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(SYSTEMS_DIR)) fs.mkdirSync(SYSTEMS_DIR);

// Helper to get objects dir for a specific system
const getObjectsDir = (systemName: string) => path.join(SYSTEMS_DIR, systemName, 'objects');
const getSystemBranchesDirLegacy = (systemName: string) => path.join(SYSTEMS_DIR, systemName, 'branches');
const getObjectDir = (systemName: string, objectName: string) =>
  path.join(getObjectsDir(systemName), objectName);
const getObjectBranchesDir = (systemName: string, objectName: string) =>
  path.join(getObjectDir(systemName, objectName), 'branches');

export const Storage = {
  listSystems: (): string[] => {
    if (!fs.existsSync(SYSTEMS_DIR)) return [];
    // Systems are now directories
    return fs.readdirSync(SYSTEMS_DIR).filter(f => fs.statSync(path.join(SYSTEMS_DIR, f)).isDirectory());
  },

  saveSystem: (config: SystemConfig) => {
    const sysDir = path.join(SYSTEMS_DIR, config.name);
    if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });
    // Save config as system.json inside the system folder
    fs.writeFileSync(path.join(sysDir, 'system.json'), JSON.stringify(config, null, 2));
  },

  loadSystem: (name: string): SystemConfig => {
    const sysPath = path.join(SYSTEMS_DIR, name, 'system.json');
    // Backwards compatibility: try loading from old flat structure if folder doesn't exist
    if (!fs.existsSync(sysPath)) {
      const oldPath = path.join(SYSTEMS_DIR, `${name}.json`);
      if (fs.existsSync(oldPath)) {
        return JSON.parse(fs.readFileSync(oldPath, 'utf-8'));
      }
    }
    return JSON.parse(fs.readFileSync(sysPath, 'utf-8'));
  },

  deleteSystem: (name: string) => {
    const sysDir = path.join(SYSTEMS_DIR, name);
    if (fs.existsSync(sysDir)) {
      fs.rmSync(sysDir, { recursive: true, force: true });
    }
    // Also clean up old file if it exists
    const oldPath = path.join(SYSTEMS_DIR, `${name}.json`);
    if (fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
    }
  },

  /**
   * Purges legacy branch storage for a system.
   *
   * This is intentionally destructive by user request: we delete legacy continuation branches
   * instead of migrating them to the new object-scoped layout.
   *
   * Legacy indicators:
   * - A system-level `branches/` directory exists, or
   * - Any `objects/*.json` file has `type === "continuation"`.
   */
  purgeLegacyBranches: (systemName: string): boolean => {
    const sysDir = path.join(SYSTEMS_DIR, systemName);
    const objectsDir = getObjectsDir(systemName);
    const legacyBranchesDir = getSystemBranchesDirLegacy(systemName);

    const hasLegacyBranchesDir = fs.existsSync(legacyBranchesDir);
    let hasLegacyContinuationObjects = false;

    if (fs.existsSync(objectsDir)) {
      for (const entry of fs.readdirSync(objectsDir)) {
        const full = path.join(objectsDir, entry);
        if (!fs.statSync(full).isFile()) continue;
        if (!entry.endsWith('.json')) continue;
        try {
          const obj = JSON.parse(fs.readFileSync(full, 'utf-8')) as AnalysisObject;
          if ((obj as any)?.type === 'continuation') {
            hasLegacyContinuationObjects = true;
            break;
          }
        } catch {
          // Ignore unreadable JSON files and continue scanning.
        }
      }
    }

    if (!hasLegacyBranchesDir && !hasLegacyContinuationObjects) {
      return false;
    }

    // Delete legacy system-level branches directory.
    if (hasLegacyBranchesDir) {
      fs.rmSync(legacyBranchesDir, { recursive: true, force: true });
    }

    // Delete any continuation objects stored as top-level objects.
    if (fs.existsSync(objectsDir)) {
      for (const entry of fs.readdirSync(objectsDir)) {
        const full = path.join(objectsDir, entry);
        const stat = fs.statSync(full);
        if (stat.isFile() && entry.endsWith('.json')) {
          try {
            const obj = JSON.parse(fs.readFileSync(full, 'utf-8')) as AnalysisObject;
            if ((obj as any)?.type === 'continuation') {
              fs.unlinkSync(full);
            }
          } catch {
            // Ignore parse errors.
          }
        }

        // Delete any object-scoped branches folders (legacy or otherwise) to ensure a clean slate.
        if (stat.isDirectory()) {
          const branchesDir = path.join(full, 'branches');
          if (fs.existsSync(branchesDir)) {
            fs.rmSync(branchesDir, { recursive: true, force: true });
          }
        }
      }
    }

    // Ensure system directory still exists after deletions.
    if (!fs.existsSync(sysDir)) fs.mkdirSync(sysDir, { recursive: true });
    return true;
  },

  listObjects: (systemName: string): string[] => {
    const objectsDir = getObjectsDir(systemName);
    if (!fs.existsSync(objectsDir)) return [];
    return fs.readdirSync(objectsDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
  },

  saveObject: (systemName: string, obj: AnalysisObject) => {
    const objectsDir = getObjectsDir(systemName);
    if (!fs.existsSync(objectsDir)) fs.mkdirSync(objectsDir, { recursive: true });
    fs.writeFileSync(path.join(objectsDir, `${obj.name}.json`), JSON.stringify(obj, null, 2));
  },

  loadObject: (systemName: string, objectName: string): AnalysisObject => {
    const objectsDir = getObjectsDir(systemName);
    return JSON.parse(fs.readFileSync(path.join(objectsDir, `${objectName}.json`), 'utf-8'));
  },

  deleteObject: (systemName: string, objectName: string) => {
    const objectsDir = getObjectsDir(systemName);
    const filePath = path.join(objectsDir, `${objectName}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Also remove any associated object folder (branches, metadata, etc.).
    const objDir = getObjectDir(systemName, objectName);
    if (fs.existsSync(objDir)) {
      fs.rmSync(objDir, { recursive: true, force: true });
    }
  },

  /**
   * Renames an object and its associated object directory (if present).
   */
  renameObject: (systemName: string, oldName: string, newName: string) => {
    const objectsDir = getObjectsDir(systemName);
    const oldPath = path.join(objectsDir, `${oldName}.json`);
    const newPath = path.join(objectsDir, `${newName}.json`);
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
    }
    const oldDir = getObjectDir(systemName, oldName);
    const newDir = getObjectDir(systemName, newName);
    if (fs.existsSync(oldDir)) {
      fs.renameSync(oldDir, newDir);
    }

    // Update parentObject pointers in any stored branches.
    const branchesDir = getObjectBranchesDir(systemName, newName);
    if (fs.existsSync(branchesDir)) {
      for (const entry of fs.readdirSync(branchesDir)) {
        if (!entry.endsWith('.json')) continue;
        const full = path.join(branchesDir, entry);
        try {
          const branch = JSON.parse(fs.readFileSync(full, 'utf-8')) as any;
          if (branch?.type === 'continuation') {
            branch.parentObject = newName;
            fs.writeFileSync(full, JSON.stringify(branch, null, 2));
          }
        } catch {
          // Ignore parse errors.
        }
      }
    }
  },

  // Object-scoped Branch Storage
  /**
   * Renames a stored branch for a given parent object.
   *
   * This updates both the on-disk filename and the `name` field inside the JSON payload.
   * It also updates any provenance references from limit-cycle objects that point at the renamed branch.
   */
  renameBranch: (systemName: string, objectName: string, oldBranchName: string, newBranchName: string) => {
    const branchesDir = getObjectBranchesDir(systemName, objectName);
    const oldPath = path.join(branchesDir, `${oldBranchName}.json`);
    const newPath = path.join(branchesDir, `${newBranchName}.json`);

    if (!fs.existsSync(oldPath)) {
      throw new Error(`Branch "${oldBranchName}" does not exist under object "${objectName}".`);
    }
    if (fs.existsSync(newPath)) {
      throw new Error(`Branch "${newBranchName}" already exists under object "${objectName}".`);
    }

    const branch = JSON.parse(fs.readFileSync(oldPath, 'utf-8')) as any;
    if (branch?.type !== 'continuation') {
      throw new Error(`Refusing to rename non-branch payload at "${oldPath}".`);
    }

    branch.name = newBranchName;
    branch.parentObject = objectName;

    fs.writeFileSync(newPath, JSON.stringify(branch, null, 2));
    fs.unlinkSync(oldPath);

    // Update provenance pointers in limit-cycle objects that reference this branch by name.
    const objectsDir = getObjectsDir(systemName);
    if (!fs.existsSync(objectsDir)) {
      return;
    }

    for (const entry of fs.readdirSync(objectsDir)) {
      const full = path.join(objectsDir, entry);
      if (!entry.endsWith('.json')) continue;
      if (!fs.statSync(full).isFile()) continue;
      try {
        const obj = JSON.parse(fs.readFileSync(full, 'utf-8')) as any;
        if (obj?.type !== 'limit_cycle') continue;
        if (!obj.origin || typeof obj.origin !== 'object') continue;

        let updated = false;

        if (obj.origin.type === 'hopf' && obj.origin.equilibriumBranchName === oldBranchName) {
          obj.origin.equilibriumBranchName = newBranchName;
          updated = true;
        }

        if (obj.origin.type === 'pd' && obj.origin.sourceBranchName === oldBranchName) {
          obj.origin.sourceBranchName = newBranchName;
          updated = true;
        }

        if (updated) {
          fs.writeFileSync(full, JSON.stringify(obj, null, 2));
        }
      } catch {
        // Ignore parse errors.
      }
    }
  },

  listBranches: (systemName: string, objectName: string): string[] => {
    const branchesDir = getObjectBranchesDir(systemName, objectName);
    if (!fs.existsSync(branchesDir)) return [];
    return fs
      .readdirSync(branchesDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  },

  saveBranch: (systemName: string, objectName: string, branch: AnalysisObject) => {
    const branchesDir = getObjectBranchesDir(systemName, objectName);
    if (!fs.existsSync(branchesDir)) fs.mkdirSync(branchesDir, { recursive: true });
    fs.writeFileSync(path.join(branchesDir, `${(branch as any).name}.json`), JSON.stringify(branch, null, 2));
  },

  loadBranch: (systemName: string, objectName: string, branchName: string): AnalysisObject => {
    const branchesDir = getObjectBranchesDir(systemName, objectName);
    return JSON.parse(fs.readFileSync(path.join(branchesDir, `${branchName}.json`), 'utf-8'));
  },

  deleteBranch: (systemName: string, objectName: string, branchName: string) => {
    const branchesDir = getObjectBranchesDir(systemName, objectName);
    const filePath = path.join(branchesDir, `${branchName}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  },
};
