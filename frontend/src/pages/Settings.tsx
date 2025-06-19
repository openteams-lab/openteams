import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import type { Config, ThemeMode, ApiResponse } from "shared/types";
import { useTheme } from "@/components/theme-provider";

export function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { setTheme } = useTheme();

  // Load initial config
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch("/api/config");
        const data: ApiResponse<Config> = await response.json();
        
        if (data.success && data.data) {
          setConfig(data.data);
        } else {
          setError(data.message || "Failed to load configuration");
        }
      } catch (err) {
        setError("Failed to load configuration");
        console.error("Error loading config:", err);
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const handleSave = async () => {
    if (!config) return;
    
    setSaving(true);
    setError(null);
    setSuccess(false);
    
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(config),
      });
      
      const data: ApiResponse<Config> = await response.json();
      
      if (data.success) {
        setSuccess(true);
        // Update theme provider to reflect the saved theme
        setTheme(config.theme);
        
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(data.message || "Failed to save configuration");
      }
    } catch (err) {
      setError("Failed to save configuration");
      console.error("Error saving config:", err);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (updates: Partial<Config>) => {
    setConfig((prev: Config | null) => prev ? { ...prev, ...updates } : null);
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="ml-2">Loading settings...</span>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load settings. {error}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">
            Configure your preferences and application settings.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert>
            <AlertDescription>Settings saved successfully!</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Customize how the application looks and feels.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="theme">Theme</Label>
                <Select
                  value={config.theme}
                  onValueChange={(value: ThemeMode) => updateConfig({ theme: value })}
                >
                  <SelectTrigger id="theme">
                    <SelectValue placeholder="Select theme" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Choose your preferred color scheme.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Task Execution</CardTitle>
              <CardDescription>
                Configure how tasks are executed and processed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="executor">Default Executor</Label>
                <Select
                  value={config.executor.type}
                  onValueChange={(value: "echo" | "claude" | "amp") => updateConfig({ executor: { type: value } })}
                >
                  <SelectTrigger id="executor">
                    <SelectValue placeholder="Select executor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="amp">Amp</SelectItem>
                    <SelectItem value="echo">Echo</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Choose the default executor for running tasks.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
