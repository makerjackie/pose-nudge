import Database from '@tauri-apps/plugin-sql';

let dbInstance: Database | null = null;

export const getDb = async (): Promise<Database> => {
  if (!dbInstance) {
    dbInstance = await Database.load('sqlite:posture_data.db');
  }
  return dbInstance;
};
