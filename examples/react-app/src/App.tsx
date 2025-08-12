import React, { useState, useEffect } from "react";
import { useRemoteStorage, useStorageItem, useStorageKeys } from "@usex/sync-client";
import "./App.css";

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

function UserPreferences({ userId }: { userId: string }) {
  const {
    value: preferences,
    setValue: setPreferences,
    isLoading,
    isConnected,
    error,
  } = useStorageItem(userId, "user-preferences", {
    theme: "light",
    language: "en",
    notifications: true,
  });

  const handleThemeToggle = async () => {
    if (!preferences) return;
    await setPreferences({
      ...preferences,
      theme: preferences.theme === "dark" ? "light" : "dark",
    });
  };

  const handleLanguageChange = async (language: string) => {
    if (!preferences) return;
    await setPreferences({
      ...preferences,
      language,
    });
  };

  const handleNotificationsToggle = async () => {
    if (!preferences) return;
    await setPreferences({
      ...preferences,
      notifications: !preferences.notifications,
    });
  };

  if (isLoading) return <div>Loading preferences...</div>;
  if (error) return <div>Error loading preferences: {error.message}</div>;
  if (!preferences) return <div>No preferences found</div>;

  return (
    <div className="preferences-section">
      <h3>User Preferences</h3>
      <div className="preference-item">
        <label>
          Theme:
          <select
            value={preferences.theme}
            onChange={(e) => setPreferences({ ...preferences, theme: e.target.value })}
            disabled={!isConnected}
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
            disabled={!isConnected}
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
            disabled={!isConnected}
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

function StorageManager({ userId }: { userId: string }) {
  const { storage, isConnected, setItem, removeItem, getAllItems } = useRemoteStorage(userId);

  const { keys } = useStorageKeys(userId);
  const [allItems, setAllItems] = useState<any[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  useEffect(() => {
    if (storage) {
      getAllItems().then(setAllItems).catch(console.error);
    }
  }, [storage, getAllItems]);

  useEffect(() => {
    if (!storage) return;

    const handleChange = () => {
      getAllItems().then(setAllItems).catch(console.error);
    };

    const handleSync = (event: any) => {
      console.log("Data synced:", event);
      getAllItems().then(setAllItems).catch(console.error);
    };

    storage.on("change", handleChange);
    storage.on("sync", handleSync);

    return () => {
      storage.off("change", handleChange);
      storage.off("sync", handleSync);
    };
  }, [storage, getAllItems]);

  const handleAddItem = async () => {
    if (!newKey || !newValue) return;

    try {
      let parsedValue: any;
      try {
        parsedValue = JSON.parse(newValue);
      } catch {
        parsedValue = newValue; // Use as string if not valid JSON
      }

      await setItem(newKey, parsedValue);
      setNewKey("");
      setNewValue("");
    } catch (error) {
      console.error("Failed to add item:", error);
      alert("Failed to add item: " + (error as Error).message);
    }
  };

  const handleRemoveItem = async (key: string) => {
    try {
      await removeItem(key);
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
            disabled={!isConnected}
          />
          <input
            type="text"
            placeholder="Value (JSON or string)"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            disabled={!isConnected}
          />
          <button onClick={handleAddItem} disabled={!isConnected || !newKey || !newValue}>
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
                  disabled={!isConnected}
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

function App() {
  const [userId, setUserId] = useState("demo-user-" + Math.random().toString(36).substr(2, 9));
  const [serverUrl, setServerUrl] = useState("http://localhost:3000");
  const [isInitialized, setIsInitialized] = useState(false);

  const { isConnected, isLoading, error } = useRemoteStorage(isInitialized ? userId : "", {
    serverUrl,
    autoConnect: true,
  });

  const handleConnect = () => {
    if (userId && serverUrl) {
      setIsInitialized(true);
    } else {
      alert("Please enter both User ID and Server URL");
    }
  };

  const handleDisconnect = () => {
    setIsInitialized(false);
  };

  return (
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
          <ConnectionStatus isConnected={isConnected} isLoading={isLoading} error={error} />
        )}
      </div>

      {isInitialized && (
        <>
          <UserPreferences userId={userId} />
          <StorageManager userId={userId} />
        </>
      )}

      <footer>
        <p>
          <strong>Try this:</strong> Open this app in multiple browser tabs or devices with the same
          User ID to see real-time synchronization in action!
        </p>
      </footer>
    </div>
  );
}

export default App;
