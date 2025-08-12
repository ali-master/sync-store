import React, { useState, useEffect, createContext, useContext } from "react";
import { useRemoteStorage, RemoteStorage } from "@usex/sync-client";
import "./App.css";

// Create a context for sharing the storage instance
const StorageContext = createContext<RemoteStorage | null>(null);

// Demo components
function ConnectionStatus({
  isConnected,
  isLoading,
  error,
}: {
  isConnected: boolean;
  isLoading: boolean;
  error: Error | null;
}) {
  if (error) {
    return <div className="status error">❌ Error: {error.message}</div>;
  }

  if (isLoading) {
    return <div className="status loading">🔄 Connecting...</div>;
  }

  return (
    <div className={`status ${isConnected ? "connected" : "disconnected"}`}>
      {isConnected ? "🟢 Connected" : "🔴 Disconnected"}
    </div>
  );
}

function UserPreferences() {
  const storage = useContext(StorageContext);
  const [preferences, setPreferences] = useState({
    theme: "light",
    language: "en",
    notifications: true,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!storage) return;

    const loadPreferences = async () => {
      try {
        const stored = await storage.getItem("user-preferences");
        if (stored) {
          setPreferences(stored);
        }
        setIsLoading(false);
      } catch (error) {
        console.error("Failed to load preferences:", error);
        setIsLoading(false);
      }
    };

    loadPreferences();

    const handleChange = (event: any) => {
      if (event.key === "user-preferences") {
        setPreferences(
          event.newValue || {
            theme: "light",
            language: "en",
            notifications: true,
          },
        );
      }
    };

    storage.on("change", handleChange);
    return () => storage.off("change", handleChange);
  }, [storage]);

  const updatePreferences = async (newPrefs: any) => {
    if (!storage) return;
    try {
      await storage.setItem("user-preferences", newPrefs);
      setPreferences(newPrefs);
    } catch (error) {
      console.error("Failed to update preferences:", error);
    }
  };

  const handleLanguageChange = async (language: string) => {
    if (!preferences) return;
    await updatePreferences({
      ...preferences,
      language,
    });
  };

  const handleNotificationsToggle = async () => {
    if (!preferences) return;
    await updatePreferences({
      ...preferences,
      notifications: !preferences.notifications,
    });
  };

  if (isLoading) return <div>Loading preferences...</div>;
  if (!storage) return <div>Storage not available</div>;
  if (!preferences) return <div>No preferences found</div>;

  return (
    <div className="preferences-section">
      <h3>User Preferences</h3>
      <div className="preference-item">
        <label>
          Theme:
          <select
            value={preferences.theme}
            onChange={(e) => updatePreferences({ ...preferences, theme: e.target.value })}
            disabled={!storage?.isConnected()}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>

      <div className="preference-item">
        <label>
          Language:
          <select
            value={preferences.language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            disabled={!storage?.isConnected()}
          >
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
          </select>
        </label>
      </div>

      <div className="preference-item">
        <label>
          <input
            type="checkbox"
            checked={preferences.notifications}
            onChange={handleNotificationsToggle}
            disabled={!storage?.isConnected()}
          />
          Enable Notifications
        </label>
      </div>

      <div className="preview">
        <h4>Current Settings:</h4>
        <pre>{JSON.stringify(preferences, null, 2)}</pre>
      </div>
    </div>
  );
}

function StorageManager() {
  const storage = useContext(StorageContext);
  const [keys, setKeys] = useState<string[]>([]);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const refreshData = async () => {
    if (!storage) return;
    try {
      const items = await storage.getAllItems();
      setAllItems(items);
      setKeys(storage.getAllKeys());
    } catch (error) {
      console.error("Failed to refresh data:", error);
    }
  };

  useEffect(() => {
    refreshData();
  }, [storage]);

  useEffect(() => {
    if (!storage) return;

    const handleChange = (event: any) => {
      console.log("Storage change event:", event);
      refreshData();
    };

    const handleSync = (event: any) => {
      console.log("Data synced:", event);
      refreshData();
    };

    storage.on("change", handleChange);
    storage.on("sync", handleSync);

    return () => {
      storage.off("change", handleChange);
      storage.off("sync", handleSync);
    };
  }, [storage]);

  const handleAddItem = async () => {
    if (!newKey || !newValue || !storage) return;

    try {
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(newValue);
      } catch {
        parsedValue = newValue; // Use as string if not valid JSON
      }

      await storage.setItem(newKey, parsedValue);
      setNewKey("");
      setNewValue("");
      // Force refresh to ensure UI updates
      await refreshData();
    } catch (error) {
      console.error("Failed to add item:", error);
      alert("Failed to add item: " + (error as Error).message);
    }
  };

  const handleRemoveItem = async (key: string) => {
    if (!storage) return;
    try {
      await storage.removeItem(key);
      // Force refresh to ensure UI updates
      await refreshData();
    } catch (error) {
      console.error("Failed to remove item:", error);
      alert("Failed to remove item: " + (error as Error).message);
    }
  };

  return (
    <div className="storage-manager">
      <h3>Storage Manager</h3>

      <div className="add-item-form">
        <h4>Add New Item</h4>
        <div className="form-row">
          <input
            type="text"
            placeholder="Key"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            disabled={!storage?.isConnected()}
          />
          <input
            type="text"
            placeholder="Value (JSON or string)"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            disabled={!storage?.isConnected()}
          />
          <button
            onClick={handleAddItem}
            disabled={!storage?.isConnected() || !newKey || !newValue}
          >
            Add
          </button>
        </div>
      </div>

      <div className="storage-info">
        <h4>Storage Info</h4>
        <p>Total Keys: {keys.length}</p>
        <p>Total Items: {allItems.length}</p>
      </div>

      <div className="items-list">
        <h4>All Items</h4>
        {allItems.length === 0 ? (
          <p>No items found</p>
        ) : (
          allItems.map((item) => (
            <div key={item.key} className="item">
              <div className="item-header">
                <strong>{item.key}</strong>
                <button
                  onClick={() => handleRemoveItem(item.key)}
                  disabled={!storage?.isConnected()}
                  className="remove-btn"
                >
                  Remove
                </button>
              </div>
              <div className="item-content">
                <pre>{JSON.stringify(item.value, null, 2)}</pre>
                {item.version && (
                  <small>
                    Version: {item.version} | Modified: {new Date(item.timestamp).toLocaleString()}
                  </small>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// @ts-ignore
export default function App() {
  const [userId, setUserId] = useState("demo-user-r68zvaaatfk0umhe4rqwpmzr");
  const [instanceId, setInstanceId] = useState("instance-j99e2yie91z5m943n12qamve");
  const [serverUrl, setServerUrl] = useState("http://localhost:3000");
  const [isInitialized, setIsInitialized] = useState(false);

  // Only create storage when actually initialized to prevent empty userId connections
  const storageResult = useRemoteStorage(userId, {
    serverUrl,
    instanceId,
    autoConnect: false, // Don't auto-connect, we'll control it manually
  });

  // Manually control connection based on isInitialized state
  useEffect(() => {
    if (
      isInitialized &&
      userId &&
      instanceId &&
      serverUrl &&
      !storageResult.storage.isConnected()
    ) {
      storageResult.storage.connect().catch(console.error);
    } else if (!isInitialized && storageResult.storage.isConnected()) {
      storageResult.storage.disconnect();
    }
  }, [isInitialized, userId, instanceId, serverUrl, storageResult.storage]);

  const handleConnect = () => {
    if (userId && instanceId && serverUrl) {
      setIsInitialized(true);
    } else {
      alert("Please enter User ID, Instance ID, and Server URL");
    }
  };

  const handleDisconnect = () => {
    setIsInitialized(false);
  };

  return (
    <StorageContext.Provider value={isInitialized ? storageResult.storage : null}>
      <div className="app">
        <header>
          <h1>🔄 Remote Sync Storage Demo</h1>
          <p>A React example showing real-time data synchronization across devices and browsers.</p>
        </header>

        <div className="connection-section">
          <h2>Connection Setup</h2>
          <div className="form-row">
            <label>
              User ID:
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                disabled={isInitialized}
                placeholder="Enter unique user ID"
              />
            </label>
            <label>
              Instance ID:
              <input
                type="text"
                value={instanceId}
                onChange={(e) => setInstanceId(e.target.value)}
                disabled={isInitialized}
                placeholder="Enter unique instance ID"
              />
            </label>
            <label>
              Server URL:
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                disabled={isInitialized}
                placeholder="http://localhost:3000"
              />
            </label>
          </div>

          <div className="connection-controls">
            {!isInitialized ? (
              <button onClick={handleConnect}>Connect</button>
            ) : (
              <button onClick={handleDisconnect}>Disconnect</button>
            )}
          </div>

          {isInitialized && (
            <ConnectionStatus
              isConnected={storageResult.isConnected}
              isLoading={storageResult.isLoading}
              error={storageResult.error}
            />
          )}
        </div>

        {isInitialized && (
          <>
            <UserPreferences />
            <StorageManager />
          </>
        )}

        <footer>
          <p>
            <strong>Try this:</strong> Open this app in multiple browser tabs or devices with the
            same User ID to see real-time synchronization in action!
          </p>
        </footer>
      </div>
    </StorageContext.Provider>
  );
}
