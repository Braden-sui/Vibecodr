"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, GripVertical } from "lucide-react";
import type { ManifestParam } from "@vibecodr/shared/manifest";
import { ParamControls } from "@/components/Player/ParamControls";

/**
 * Params Designer Tab
 * Create and configure parameters for a vibe with live preview
 * Based on mvp-plan.md Phase 2 requirements
 */
export function ParamsTab() {
  const [params, setParams] = useState<ManifestParam[]>([
    {
      name: "count",
      type: "slider",
      label: "Particle Count",
      description: "Number of particles to render",
      default: 100,
      min: 10,
      max: 500,
      step: 10,
    },
  ]);
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({
    count: 100,
  });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const addParam = () => {
    const newParam: ManifestParam = {
      name: `param${params.length + 1}`,
      type: "slider",
      label: "New Parameter",
      default: 50,
      min: 0,
      max: 100,
      step: 1,
    };
    setParams([...params, newParam]);
    setParamValues({ ...paramValues, [newParam.name]: newParam.default });
  };

  const removeParam = (index: number) => {
    const param = params[index];
    const newParams = params.filter((_, i) => i !== index);
    const newValues = { ...paramValues };
    delete newValues[param.name];
    setParams(newParams);
    setParamValues(newValues);
    setEditingIndex(null);
  };

  const updateParam = (index: number, updates: Partial<ManifestParam>) => {
    const newParams = [...params];
    const oldName = newParams[index].name;
    newParams[index] = { ...newParams[index], ...updates };

    // If name changed, update values map
    if (updates.name && updates.name !== oldName) {
      const newValues = { ...paramValues };
      newValues[updates.name] = newValues[oldName];
      delete newValues[oldName];
      setParamValues(newValues);
    }

    setParams(newParams);
  };

  return (
    <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
      {/* Left: Param Editor */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Parameters</h2>
            <p className="text-sm text-muted-foreground">
              Define interactive controls for your vibe
            </p>
          </div>
          <Button onClick={addParam} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Param
          </Button>
        </div>

        <div className="space-y-3">
          {params.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-muted-foreground">No parameters yet</p>
                <Button onClick={addParam} variant="outline" className="mt-4 gap-2">
                  <Plus className="h-4 w-4" />
                  Add Your First Parameter
                </Button>
              </CardContent>
            </Card>
          ) : (
            params.map((param, index) => (
              <Card
                key={index}
                className={editingIndex === index ? "ring-2 ring-primary" : ""}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <CardTitle className="text-base">{param.label}</CardTitle>
                        <CardDescription className="text-xs">
                          {param.name} • {param.type}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() =>
                          setEditingIndex(editingIndex === index ? null : index)
                        }
                      >
                        ✏️
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => removeParam(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                {editingIndex === index && (
                  <CardContent className="space-y-3 border-t pt-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor={`name-${index}`}>Name</Label>
                        <Input
                          id={`name-${index}`}
                          value={param.name}
                          onChange={(e) =>
                            updateParam(index, { name: e.target.value })
                          }
                          placeholder="paramName"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`type-${index}`}>Type</Label>
                        <Select
                          value={param.type}
                          onValueChange={(value) =>
                            updateParam(index, { type: value as ManifestParam["type"] })
                          }
                        >
                          <SelectTrigger id={`type-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="slider">Slider</SelectItem>
                            <SelectItem value="toggle">Toggle</SelectItem>
                            <SelectItem value="select">Select</SelectItem>
                            <SelectItem value="text">Text</SelectItem>
                            <SelectItem value="number">Number</SelectItem>
                            <SelectItem value="color">Color</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`label-${index}`}>Label</Label>
                      <Input
                        id={`label-${index}`}
                        value={param.label}
                        onChange={(e) =>
                          updateParam(index, { label: e.target.value })
                        }
                        placeholder="Display label"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`description-${index}`}>Description (optional)</Label>
                      <Input
                        id={`description-${index}`}
                        value={param.description || ""}
                        onChange={(e) =>
                          updateParam(index, { description: e.target.value })
                        }
                        placeholder="Brief description"
                      />
                    </div>

                    {(param.type === "slider" || param.type === "number") && (
                      <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-2">
                          <Label htmlFor={`min-${index}`}>Min</Label>
                          <Input
                            id={`min-${index}`}
                            type="number"
                            value={param.min || 0}
                            onChange={(e) =>
                              updateParam(index, { min: Number(e.target.value) })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`max-${index}`}>Max</Label>
                          <Input
                            id={`max-${index}`}
                            type="number"
                            value={param.max || 100}
                            onChange={(e) =>
                              updateParam(index, { max: Number(e.target.value) })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`step-${index}`}>Step</Label>
                          <Input
                            id={`step-${index}`}
                            type="number"
                            value={param.step || 1}
                            onChange={(e) =>
                              updateParam(index, { step: Number(e.target.value) })
                            }
                          />
                        </div>
                      </div>
                    )}

                    {param.type === "select" && (
                      <div className="space-y-2">
                        <Label>Options (comma-separated)</Label>
                        <Input
                          value={param.options?.join(", ") || ""}
                          onChange={(e) =>
                            updateParam(index, {
                              options: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Option 1, Option 2, Option 3"
                        />
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Right: Live Preview */}
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-bold">Live Preview</h2>
          <p className="text-sm text-muted-foreground">
            Test how parameters will appear to users
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parameter Controls</CardTitle>
            <CardDescription>
              This is how users will see and interact with your parameters
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ParamControls
              params={params}
              values={paramValues}
              onChange={(name, value) => {
                setParamValues({ ...paramValues, [name]: value });
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current Values</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="rounded-md bg-muted p-3 text-xs">
              {JSON.stringify(paramValues, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
