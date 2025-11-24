import { fireEvent } from "@testing-library/react";

type Target = Element | null;

function ensureInputValue(target: Target, nextValue: string) {
  if (target && "value" in target) {
    (target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value = nextValue;
  }
}

const userEvent = {
  setup: () => userEvent,
  click: async (target: Target, init?: MouseEventInit) => {
    if (!target) return;
    fireEvent.click(target, init);
  },
  type: async (target: Target, text: string) => {
    if (!target) return;
    ensureInputValue(target, text);
    fireEvent.input(target, { target: { value: text } });
  },
  selectOptions: async (target: Target, values: string | string[]) => {
    if (!target) return;
    const value = Array.isArray(values) ? values[0] : values;
    ensureInputValue(target, value);
    fireEvent.change(target, { target: { value } });
  },
  upload: async (target: Target, files: File | File[]) => {
    if (!target) return;
    const fileList = Array.isArray(files) ? files : [files];
    Object.defineProperty(target as HTMLInputElement, "files", { value: fileList });
    fireEvent.change(target, { target: { files: fileList } });
  },
  keyboard: async () => {
    // no-op keyboard stub
  },
  clear: async (target: Target) => {
    if (!target) return;
    ensureInputValue(target, "");
    fireEvent.input(target, { target: { value: "" } });
  },
};

export default userEvent;
export { userEvent };
