import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import type { Config, ApiResponse } from 'shared/types';

interface ConfigContextType {
  config: Config | null;
  updateConfig: (updates: Partial<Config>) => void;
  saveConfig: () => Promise<boolean>;
  loading: boolean;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

interface ConfigProviderProps {
  children: ReactNode;
}

export function ConfigProvider({ children }: ConfigProviderProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/config');
        const data: ApiResponse<Config> = await response.json();

        if (data.success && data.data) {
          setConfig(data.data);
        }
      } catch (err) {
        console.error('Error loading config:', err);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const updateConfig = (updates: Partial<Config>) => {
    setConfig((prev) => (prev ? { ...prev, ...updates } : null));
  };

  const saveConfig = async (): Promise<boolean> => {
    if (!config) return false;

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      const data: ApiResponse<Config> = await response.json();
      return data.success;
    } catch (err) {
      console.error('Error saving config:', err);
      return false;
    }
  };

  return (
    <ConfigContext.Provider
      value={{ config, updateConfig, saveConfig, loading }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}
