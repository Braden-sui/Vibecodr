import { fireEvent } from "@testing-library/react";

type Target = Element | Document | Window | null;

function ensureInputValue(target: EventTarget | null, nextValue: string) {
  if (target && "value" in (target as any)) {
    (target as any).value = nextValue;
  }
}

const userEvent = {
  setup: () => userEvent,
  click: async (target: Target, init?: MouseEventInit) => {
    if (!target) return;
    fireEvent.click(target as Element, init);
  },
  type: async (target: Target, text: string) => {
    if (!target) return;
    const el = target as any;
    ensureInputValue(el, text);
    fireEvent.input(el, { target: { value: text } });
  },
  selectOptions: async (target: Target, values: string | string[]) => {
    if (!target) return;
    const value = Array.isArray(values) ? values[0] : values;
    ensureInputValue(target as any, value);
    fireEvent.change(target as any, { target: { value } });
  },
  upload: async (target: Target, files: File | File[]) => {
    if (!target) return;
    const fileList = Array.isArray(files) ? files : [files];
    Object.defineProperty(target, "files", { value: fileList });
    fireEvent.change(target as any, { target: { files: fileList } });
  },
  keyboard: async () => {
    // no-op keyboard stub
  },
  clear: async (target: Target) => {
    if (!target) return;
    ensureInputValue(target as any, "");
    fireEvent.input(target as any, { target: { value: "" } });
  },
};

export default userEvent;
export { userEvent };
