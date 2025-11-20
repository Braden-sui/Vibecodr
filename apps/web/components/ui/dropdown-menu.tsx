"use client";

import * as React from "react";
import { Check, ChevronRight, Circle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Menu } from "@/lib/animate-ui/menuPrimitives";
import { Highlight, HighlightItem } from "@/lib/animate-ui/highlight";

const DropdownMenu = Menu.Root;

const DropdownMenuGroup = Menu.Group;

const DropdownMenuPortal = Menu.Portal;

const DropdownMenuSub = Menu.SubmenuRoot;

const DropdownMenuRadioGroup = Menu.RadioGroup;

const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof Menu.Trigger>,
  React.ComponentPropsWithoutRef<typeof Menu.Trigger> & { asChild?: boolean }
>(({ asChild, children, className, ...props }, ref) => {
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>;
    return (
      <Menu.Trigger
        {...props}
        ref={ref}
        nativeButton={false}
        render={(triggerProps) =>
          React.cloneElement(child, {
            ...(triggerProps as Record<string, unknown>),
            className: cn(
              (triggerProps as { className?: string }).className,
              child.props.className,
              className
            ),
          })
        }
      />
    );
  }

  return (
    <Menu.Trigger
      {...props}
      ref={ref}
      className={className}
    >
      {children}
    </Menu.Trigger>
  );
});
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof Menu.SubmenuTrigger>,
  React.ComponentPropsWithoutRef<typeof Menu.SubmenuTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <Menu.SubmenuTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm font-medium outline-none data-[popup-open]:bg-accent",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </Menu.SubmenuTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

type DropdownMenuContentProps = React.ComponentPropsWithoutRef<typeof Menu.Popup> & {
  sideOffset?: number;
  align?: "start" | "center" | "end";
};

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof Menu.Popup>,
  DropdownMenuContentProps
>(({ className, sideOffset = 4, align = "start", children, ...props }, ref) => (
  <Menu.Portal>
    <Menu.Positioner sideOffset={sideOffset} align={align}>
      <Menu.Popup
        ref={ref}
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      >
        <Highlight>{children}</Highlight>
      </Menu.Popup>
    </Menu.Positioner>
  </Menu.Portal>
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof Menu.Popup>,
  DropdownMenuContentProps
>(({ className, sideOffset = 4, align = "center", children, ...props }, ref) => (
  <Menu.Portal>
    <Menu.Positioner sideOffset={sideOffset} align={align}>
      <Menu.Popup
        ref={ref}
        className={cn(
          "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[open]:animate-in data-[closed]:animate-out data-[closed]:fade-out-0 data-[open]:fade-in-0 data-[closed]:zoom-out-95 data-[open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      >
        <Highlight>{children}</Highlight>
      </Menu.Popup>
    </Menu.Positioner>
  </Menu.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof Menu.Item>,
  React.ComponentPropsWithoutRef<typeof Menu.Item> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => {
  const setItemRef = (node: HTMLElement | null) => {
    if (typeof ref === "function") {
      ref(node as React.ElementRef<typeof Menu.Item> | null);
    } else if (ref && "current" in ref) {
      (ref as React.MutableRefObject<React.ElementRef<typeof Menu.Item> | null>).current =
        node as React.ElementRef<typeof Menu.Item> | null;
    }
  };

  return (
    <HighlightItem
      asChild
      ref={setItemRef}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        className
      )}
      {...props}
    >
      <Menu.Item>{children}</Menu.Item>
    </HighlightItem>
  );
});
DropdownMenuItem.displayName = "DropdownMenuItem";

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof Menu.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof Menu.CheckboxItem>
>(({ className, children, ...props }, ref) => {
  const setCheckboxRef = (node: HTMLElement | null) => {
    if (typeof ref === "function") {
      ref(node as React.ElementRef<typeof Menu.CheckboxItem> | null);
    } else if (ref && "current" in ref) {
      (ref as React.MutableRefObject<React.ElementRef<typeof Menu.CheckboxItem> | null>).current =
        node as React.ElementRef<typeof Menu.CheckboxItem> | null;
    }
  };

  return (
    <HighlightItem
      asChild
      ref={setCheckboxRef}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <Menu.CheckboxItem>
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <Menu.CheckboxItemIndicator>
            <Check className="h-4 w-4" />
          </Menu.CheckboxItemIndicator>
        </span>
        {children}
      </Menu.CheckboxItem>
    </HighlightItem>
  );
});
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof Menu.RadioItem>,
  React.ComponentPropsWithoutRef<typeof Menu.RadioItem>
>(({ className, children, value, ...props }, ref) => {
  const setRadioRef = (node: HTMLElement | null) => {
    if (typeof ref === "function") {
      ref(node as React.ElementRef<typeof Menu.RadioItem> | null);
    } else if (ref && "current" in ref) {
      (ref as React.MutableRefObject<React.ElementRef<typeof Menu.RadioItem> | null>).current =
        node as React.ElementRef<typeof Menu.RadioItem> | null;
    }
  };

  return (
    <HighlightItem
      asChild
      ref={setRadioRef}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <Menu.RadioItem value={value}>
        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
          <Menu.RadioItemIndicator>
            <Circle className="h-2 w-2 fill-current" />
          </Menu.RadioItemIndicator>
        </span>
        {children}
      </Menu.RadioItem>
    </HighlightItem>
  );
});
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof Menu.GroupLabel>,
  React.ComponentPropsWithoutRef<typeof Menu.GroupLabel> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <Menu.GroupLabel
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof Menu.Separator>,
  React.ComponentPropsWithoutRef<typeof Menu.Separator>
>(({ className, ...props }, ref) => (
  <Menu.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto text-xs tracking-widest opacity-60", className)} {...props} />;
};
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};
