"use client";

import { useState, useEffect } from "react";
import type { ManifestParam } from "@vibecodr/shared/manifest";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Sliders } from "lucide-react";

export interface ParamControlsProps {
  params: ManifestParam[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  disabled?: boolean;
}

/**
 * Dynamic param controls based on manifest
 * Maps manifest param descriptors to appropriate UI controls
 * Based on research-sandbox-and-runner.md param recommendations
 */
export function ParamControls({ params, values, onChange, disabled = false }: ParamControlsProps) {
  if (!params || params.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
        <Sliders className="mb-2 h-8 w-8 opacity-50" />
        <p className="text-sm">No parameters available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {params.map((param) => (
        <ParamControl
          key={param.name}
          param={param}
          value={values[param.name] ?? param.default}
          onChange={(value) => onChange(param.name, value)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

interface ParamControlProps {
  param: ManifestParam;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}

function ParamControl({ param, value, onChange, disabled }: ParamControlProps) {
  const [localValue, setLocalValue] = useState(value);

  // Debounce slider/number updates
  useEffect(() => {
    if (param.type === "slider" || param.type === "number") {
      const timeout = setTimeout(() => {
        onChange(localValue);
      }, 150); // 150ms debounce for smooth param updates
      return () => clearTimeout(timeout);
    }
  }, [localValue, param.type, onChange]);

  const handleChange = (newValue: unknown) => {
    setLocalValue(newValue);
    // Non-debounced types update immediately
    if (param.type !== "slider" && param.type !== "number") {
      onChange(newValue);
    }
  };

  return (
    <Card className="p-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <Label htmlFor={param.name} className="text-sm font-medium">
              {param.label}
            </Label>
            {param.description && (
              <p className="mt-1 text-xs text-muted-foreground">{param.description}</p>
            )}
          </div>
          {(param.type === "slider" || param.type === "number") && (
            <span className="ml-2 text-sm font-mono text-muted-foreground">
              {typeof localValue === "number"
                ? localValue.toFixed(2)
                : String(localValue ?? "")}
            </span>
          )}
        </div>

        <div className="mt-2">
          {param.type === "slider" && (
            <Slider
              id={param.name}
              min={param.min ?? 0}
              max={param.max ?? 100}
              step={param.step ?? 1}
              value={[typeof localValue === "number" ? localValue : Number(param.default)]}
              onValueChange={([val]) => handleChange(val)}
              disabled={disabled}
            />
          )}

          {param.type === "toggle" && (
            <div className="flex items-center space-x-2">
              <Switch
                id={param.name}
                checked={Boolean(localValue)}
                onCheckedChange={handleChange}
                disabled={disabled}
              />
              <Label htmlFor={param.name} className="text-sm text-muted-foreground">
                {Boolean(localValue) ? "On" : "Off"}
              </Label>
            </div>
          )}

          {param.type === "select" && param.options && (
            <Select
              value={String(localValue)}
              onValueChange={handleChange}
              disabled={disabled}
            >
              <SelectTrigger id={param.name}>
                <SelectValue placeholder={`Select ${param.label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {param.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {param.type === "text" && (
            <Input
              id={param.name}
              type="text"
              value={String(localValue)}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={param.placeholder}
              maxLength={param.maxLength}
              disabled={disabled}
            />
          )}

          {param.type === "number" && (
            <Input
              id={param.name}
              type="number"
              value={String(localValue)}
              onChange={(e) => handleChange(Number(e.target.value))}
              min={param.min}
              max={param.max}
              step={param.step ?? 1}
              disabled={disabled}
            />
          )}

          {param.type === "color" && (
            <div className="flex gap-2">
              <Input
                id={param.name}
                type="color"
                value={String(localValue)}
                onChange={(e) => handleChange(e.target.value)}
                disabled={disabled}
                className="h-10 w-20"
              />
              <Input
                type="text"
                value={String(localValue)}
                onChange={(e) => handleChange(e.target.value)}
                disabled={disabled}
                className="flex-1 font-mono text-sm"
                placeholder="#000000"
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
