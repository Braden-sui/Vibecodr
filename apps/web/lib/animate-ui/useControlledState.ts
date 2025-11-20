"use client";

import * as React from "react";

export interface ControlledStateProps<T, Rest extends unknown[] = []> {
  value?: T;
  defaultValue?: T;
  onChange?: (value: T, ...args: Rest) => void;
}

export function useControlledState<T, Rest extends unknown[] = []>(
  props: ControlledStateProps<T, Rest>
): readonly [T | undefined, (next: T, ...args: Rest) => void] {
  const { value, defaultValue, onChange } = props;
  const isControlled = value !== undefined;

  const [internalValue, setInternalValue] = React.useState<T | undefined>(
    defaultValue
  );

  const currentValue = isControlled ? value : internalValue;

  const setValue = React.useCallback(
    (next: T, ...args: Rest) => {
      if (!isControlled) {
        setInternalValue(next);
      }

      if (onChange) {
        onChange(next, ...args);
      }
    },
    [isControlled, onChange]
  );

  return [currentValue, setValue] as const;
}

