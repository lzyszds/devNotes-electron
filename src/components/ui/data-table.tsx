import {
  memo,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type Table as TanstackTable,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"

import { cn } from "../../lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table"

/*
 * Data Table = 官方 Table 原语 + TanStack Table + 行虚拟化。
 *
 * 只挂视口内的行；刷新时靠稳定 getRowId + memo 行组件就地换数据，
 * 避免整表卸挂导致图标/按钮 DOM 重建闪一下。
 */

export type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  getRowId?: (row: TData, index: number) => string
  /** 估算行高；虚拟窗口按等高算，单元格内容别撑高 */
  estimateRowHeight?: number
  overscan?: number
  /** 滚动视口高度；不传则 max-h-[min(520px,60vh)] */
  maxHeight?: number | string
  minWidth?: number | string
  className?: string
  empty?: ReactNode
  onRowClick?: (row: TData) => void
  onRowDoubleClick?: (row: TData) => void
  rowClassName?: (row: TData) => string | undefined
  meta?: Record<string, unknown>
  /** 距底部 threshold 内触发翻页；调用方自己判 hasMore / 防重入 */
  onNearEnd?: () => void
  nearEndThresholdPx?: number
}

export function DataTable<TData>({
  columns,
  data,
  getRowId,
  estimateRowHeight = 56,
  overscan = 8,
  maxHeight = "min(520px, 60vh)",
  minWidth,
  className,
  empty,
  onRowClick,
  onRowDoubleClick,
  rowClassName,
  meta,
  onNearEnd,
  nearEndThresholdPx = 280,
}: DataTableProps<TData>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const onNearEndRef = useRef(onNearEnd)
  onNearEndRef.current = onNearEnd

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    meta,
  })

  const rows = table.getRowModel().rows
  const colCount = Math.max(1, table.getVisibleLeafColumns().length)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
    getItemKey: (index) => rows[index]?.id ?? index,
  })

  const heightStyle: CSSProperties =
    typeof maxHeight === "number"
      ? { maxHeight }
      : { maxHeight: maxHeight as string }

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  useEffect(() => {
    if (!onNearEndRef.current || !rows.length) return
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    /* 视口末行接近数据末尾时补页，而不是等真的滚到物理底 */
    if (last.index >= rows.length - 1 - Math.max(2, overscan)) {
      onNearEndRef.current()
    }
  }, [virtualItems, rows.length, overscan, totalSize])

  useEffect(() => {
    if (!onNearEndRef.current) return
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const remain = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remain <= nearEndThresholdPx) onNearEndRef.current?.()
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [nearEndThresholdPx, rows.length])

  return (
    <div
      ref={scrollRef}
      className={cn("relative w-full overflow-scroll", className)}
      style={heightStyle}
    >
      <Table
        /* 只要行底部分割线，不要格子四边框；外框留给上层卡片 */
        className="data-table grid border-0"
        style={
          minWidth != null
            ? {
                minWidth:
                  typeof minWidth === "number" ? `${minWidth}px` : minWidth,
              }
            : undefined
        }
      >
        <TableHeader className="sticky top-0 z-10 grid bg-background/95 backdrop-blur-sm [&_tr]:border-b-0">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              className="flex w-full border-0 border-b border-border/60 bg-muted/30 hover:bg-muted/30"
            >
              {headerGroup.headers.map((header) => {
                const size = header.getSize()
                return (
                  <TableHead
                    key={header.id}
                    className="flex h-9 items-center border-0 bg-transparent px-2 text-[11px]"
                    style={{
                      width: size,
                      minWidth: size,
                      flex: `${size} 0 auto`,
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody
          className="relative grid [&_tr]:border-b-0"
          style={{
            height: rows.length ? `${totalSize}px` : undefined,
          }}
        >
          {rows.length === 0 ? (
            <TableRow className="flex w-full border-0 hover:bg-transparent">
              <TableCell
                colSpan={colCount}
                className="h-28 w-full flex-1 border-0 p-2 text-center text-muted-foreground"
              >
                {empty ?? "暂无数据"}
              </TableCell>
            </TableRow>
          ) : (
            virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index] as Row<TData>
              return (
                <DataTableVirtualRow
                  key={row.id}
                  row={row}
                  table={table}
                  start={virtualRow.start}
                  onRowClick={onRowClick}
                  onRowDoubleClick={onRowDoubleClick}
                  rowClassName={rowClassName}
                />
              )
            })
          )}
        </TableBody>
      </Table>
    </div>
  )
}

const DataTableVirtualRow = memo(function DataTableVirtualRow<TData>({
  row,
  table,
  start,
  onRowClick,
  onRowDoubleClick,
  rowClassName,
}: {
  row: Row<TData>
  table: TanstackTable<TData>
  start: number
  onRowClick?: (row: TData) => void
  onRowDoubleClick?: (row: TData) => void
  rowClassName?: (row: TData) => string | undefined
}) {
  void table
  const original = row.original
  return (
    <TableRow
      data-state={row.getIsSelected() ? "selected" : undefined}
      className={cn(
        "absolute left-0 flex w-full border-0 border-b border-border/50",
        (onRowClick || onRowDoubleClick) && "cursor-pointer",
        rowClassName?.(original),
      )}
      style={{ transform: `translateY(${start}px)` }}
      onClick={onRowClick ? () => onRowClick(original) : undefined}
      onDoubleClick={
        onRowDoubleClick ? () => onRowDoubleClick(original) : undefined
      }
    >
      {row.getVisibleCells().map((cell) => {
        const size = cell.column.getSize()
        return (
          <TableCell
            key={cell.id}
            className="flex items-center overflow-hidden border-0 bg-transparent p-2 py-3"
            style={{
              width: size,
              minWidth: size,
              flex: `${size} 0 auto`,
            }}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        )
      })}
    </TableRow>
  )
}) as <TData>(props: {
  row: Row<TData>
  table: TanstackTable<TData>
  start: number
  onRowClick?: (row: TData) => void
  onRowDoubleClick?: (row: TData) => void
  rowClassName?: (row: TData) => string | undefined
}) => ReactElement
