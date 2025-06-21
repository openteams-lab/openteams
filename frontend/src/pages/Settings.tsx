import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import type { ThemeMode, EditorType } from "shared/types";
import { useTheme } from "@/components/theme-provider";
import { useConfig } from "@/components/config-provider";

export function Settings() {
  const { config, updateConfig, saveConfig, loading } = useConfig();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { setTheme } = useTheme();

  const handleSave = async () => {
    if (!config) return;
    
    setSaving(true);
    setError(null);
    setSuccess(false);
    
    try {
      const success = await saveConfig();
      
      if (success) {
        setSuccess(true);
        // Update theme provider to reflect the saved theme
        setTheme(config.theme);
        
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError("Failed to save configuration");
      }
    } catch (err) {
      setError("Failed to save configuration");
      console.error("Error saving config:", err);
    } finally {
      setSaving(false);
    }
  };

  const resetDisclaimer = async () => {
    if (!config) return;
    
    updateConfig({ disclaimer_acknowledged: false });
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

          <Card>
            <CardHeader>
              <CardTitle>Editor</CardTitle>
              <CardDescription>
                Configure which editor to open when viewing task attempts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="editor">Preferred Editor</Label>
                <Select
                  value={config.editor.editor_type}
                  onValueChange={(value: EditorType) => updateConfig({ 
                    editor: { 
                      ...config.editor, 
                      editor_type: value,
                      custom_command: value === "custom" ? config.editor.custom_command : null
                    } 
                  })}
                >
                  <SelectTrigger id="editor">
                    <SelectValue placeholder="Select editor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="vscode">VS Code</SelectItem>
                    <SelectItem value="cursor">Cursor</SelectItem>
                    <SelectItem value="windsurf">Windsurf</SelectItem>
                    <SelectItem value="intellij">IntelliJ IDEA</SelectItem>
                    <SelectItem value="zed">Zed</SelectItem>
                    <SelectItem value="custom">Custom Command</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Choose your preferred code editor for opening task attempts.
                </p>
              </div>
              
              {config.editor.editor_type === "custom" && (
                <div className="space-y-2">
                  <Label htmlFor="custom-command">Custom Command</Label>
                  <Input
                    id="custom-command"
                    placeholder="e.g., code, subl, vim"
                    value={config.editor.custom_command || ""}
                    onChange={(e) => updateConfig({ 
                      editor: { 
                        ...config.editor, 
                        custom_command: e.target.value || null
                      } 
                    })}
                  />
                  <p className="text-sm text-muted-foreground">
                    Enter the command to run your custom editor. Use spaces for arguments (e.g., "code --wait").
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>
                Configure how you receive notifications about task completion.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="sound-alerts"
                  checked={config.sound_alerts}
                  onCheckedChange={(checked: boolean) => updateConfig({ sound_alerts: checked })}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="sound-alerts" className="cursor-pointer">Sound Alerts</Label>
                  <p className="text-sm text-muted-foreground">
                    Play a sound when task attempts finish running.
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="push-notifications"
                  checked={config.push_notifications}
                  onCheckedChange={(checked: boolean) => updateConfig({ push_notifications: checked })}
                />
                <div className="space-y-0.5">
                  <Label htmlFor="push-notifications" className="cursor-pointer">Push Notifications (macOS)</Label>
                  <p className="text-sm text-muted-foreground">
                    Show system notifications when task attempts finish running.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Safety & Disclaimers</CardTitle>
              <CardDescription>
                Manage safety warnings and acknowledgments.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Disclaimer Status</Label>
                    <p className="text-sm text-muted-foreground">
                      {config.disclaimer_acknowledged 
                        ? "You have acknowledged the safety disclaimer." 
                        : "The safety disclaimer has not been acknowledged."}
                    </p>
                  </div>
                  <Button
                    onClick={resetDisclaimer}
                    variant="outline"
                    size="sm"
                    disabled={!config.disclaimer_acknowledged}
                  >
                    Reset Disclaimer
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Resetting the disclaimer will require you to acknowledge the safety warning again on next app start.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sticky save button */}
        <div className="fixed bottom-0 left-0 right-0 bg-background/80 backdrop-blur-sm border-t p-4 z-10">
          <div className="container mx-auto max-w-4xl flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Settings
            </Button>
          </div>
        </div>
        
        {/* Spacer to prevent content from being hidden behind sticky button */}
        <div className="h-20"></div>
      </div>
    </div>
  );
}
