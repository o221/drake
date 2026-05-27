import { useState, useEffect } from "react";

export interface UserSettings {
  theme: "light" | "dark" | "system";
  autoRunQueries: boolean;
  maxRowsPreview: number;
}

const STORAGE_KEY = "drake-react.settings";
const SETTINGS_UPDATED_EVENT = "drake-react.settings.updated";

const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  autoRunQueries: true,
  maxRowsPreview: 1000,
};

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const loadSettings = () => {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        setSettings(DEFAULT_SETTINGS);
        return;
      }
      try {
        const nextSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } as UserSettings;
        setSettings(nextSettings);
      } catch (e) {
        console.error("Failed to load settings", e);
        setSettings(DEFAULT_SETTINGS);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== STORAGE_KEY) {
        return;
      }
      loadSettings();
    };

    const handleLocalUpdate = () => {
      loadSettings();
    };

    loadSettings();
    setIsLoaded(true);

    window.addEventListener("storage", handleStorage);
    window.addEventListener(SETTINGS_UPDATED_EVENT, handleLocalUpdate);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(SETTINGS_UPDATED_EVENT, handleLocalUpdate);
    };
  }, []);

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new Event(SETTINGS_UPDATED_EVENT));
      return next;
    });
  };

  return {
    settings,
    isLoaded,
    updateSetting,
  };
}
