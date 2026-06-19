import React from "react";

type ScrollAreaOrientation = "vertical" | "horizontal" | "both";
type ScrollbarMode = "styled" | "hidden";

interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: ScrollAreaOrientation;
  scrollbar?: ScrollbarMode;
}

const orientationClasses: Record<ScrollAreaOrientation, string> = {
  vertical: "overflow-y-auto overflow-x-hidden",
  horizontal: "overflow-x-auto overflow-y-hidden",
  both: "overflow-auto",
};

export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  (
    {
      orientation = "vertical",
      scrollbar = "styled",
      className = "",
      children,
      ...props
    },
    ref,
  ) => {
    const scrollbarClass =
      scrollbar === "hidden"
        ? "ot-scroll-area-hidden overflow-hidden"
        : `ot-scroll-area-styled ${orientationClasses[orientation]}`;

    return (
      <div
        ref={ref}
        className={`min-h-0 min-w-0 ${scrollbarClass} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  },
);

ScrollArea.displayName = "ScrollArea";
