/*
 * shadcn 原语集（vanilla 源码 + 全局语义 token 映射成现设计）。
 *
 * 放在独立目录而不是与 ui/ 平级，是有意的迁移策略：
 *  - ui/* 旧件保持原 API，62 个消费方一行不改，避免「全局替换式」迁移把
 *    20 个工具同时炸出回归；
 *  - 新代码用这里的样子：语义色已在 tailwind.config 的 shadcn token 段
 *    映射成现设计（primary=#1C1C1C / border=#E6E6E3 / muted=#FBFBFA…），
 *    所以 shadcn 版本长出来就是本应用的脸；
 *  - 存量组件由内向外逐步迁入（如设置弹窗换成 Dialog、上下文菜单换成
 *    DropdownMenu），从外壳到内容逐层替换，用户看到的是「更顺更稳」，不是「换了套 UI」。
 */
export { Button, buttonVariants, type ButtonProps } from './button'
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from './dialog'
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './tooltip'
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from './dropdown-menu'
export { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from './popover'
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from './select'
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '../table'
export { DataTable, type DataTableProps } from '../data-table'
