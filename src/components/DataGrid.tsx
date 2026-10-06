"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type RowClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

ModuleRegistry.registerModules([AllCommunityModule]);

// One AG Grid theme driven by the app's CSS tokens, so tables follow the
// light/dark palette like everything else.
const theme = themeQuartz.withParams({
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--ink)",
  headerBackgroundColor: "var(--surface-2)",
  headerTextColor: "var(--ink-2)",
  borderColor: "var(--line)",
  rowHoverColor: "var(--surface-2)",
  selectedRowBackgroundColor: "var(--amber-soft)",
  accentColor: "var(--amber)",
  fontFamily: "var(--font-body), system-ui, sans-serif",
  fontSize: 13,
  headerFontWeight: 600,
  rowHeight: 38,
  headerHeight: 36,
  wrapperBorderRadius: 10,
});

export function DataGrid<T>({
  rows,
  columns,
  onRowClick,
  height = 420,
  getRowId,
}: {
  rows: T[];
  columns: ColDef<T>[];
  onRowClick?: (row: T) => void;
  height?: number | string;
  getRowId?: (row: T) => string;
}) {
  return (
    <div style={{ height, width: "100%" }}>
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={{ sortable: true, resizable: true, suppressMovable: true }}
        animateRows
        getRowId={getRowId ? (p) => getRowId(p.data) : undefined}
        onRowClicked={onRowClick ? (e: RowClickedEvent<T>) => e.data && onRowClick(e.data) : undefined}
      />
    </div>
  );
}
