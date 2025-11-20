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
  }
};
