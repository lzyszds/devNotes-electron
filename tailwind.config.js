import tailwindcssAnimate from 'tailwindcss-animate'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  /*
   * darkMode: 'class' 保留（prune-dark.mjs 已把全部 dark: 死样式清零），
   * 将来若恢复暗色， dressing直接走 shadcn 的语义 token —— semantic 只需要
   * 在 .dark 上覆写一组 HSL 变量即可，不用再回到两套字面量并存的老路。
   */
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        warm: {
          sidebar: '#F3F3F1',
          list: '#F9F9F8',
          canvas: '#FFFFFF',
          border: '#E6E6E3',
          borderSubtle: '#EAEAE7',
          tableHeader: '#FBFBFA',
          text: '#191918',
          muted: '#787774',
          cardSub: '#D4D4D0',
          charcoal: '#1C1C1C',
        },
        /*
         * 主色 brand 色板：通过 CSS 变量动态驱动，支持 10 套主题随时换肤，
         * 并支持 Tailwind v3 的透明度修饰符（如 bg-brand-500/20）。
         * 默认回退值对应经典青蓝（logo 青蓝 #50BDCF / #218397）。
         */
        brand: {
          50: 'rgb(var(--brand-50-rgb, 239 250 251) / <alpha-value>)',
          100: 'rgb(var(--brand-100-rgb, 219 243 245) / <alpha-value>)',
          200: 'rgb(var(--brand-200-rgb, 182 230 236) / <alpha-value>)',
          300: 'rgb(var(--brand-300-rgb, 143 215 224) / <alpha-value>)',
          400: 'rgb(var(--brand-400-rgb, 111 202 216) / <alpha-value>)',
          500: 'rgb(var(--brand-500-rgb, 80 189 207) / <alpha-value>)',
          600: 'rgb(var(--brand-600-rgb, 33 131 151) / <alpha-value>)',
          700: 'rgb(var(--brand-700-rgb, 22 99 116) / <alpha-value>)',
          800: 'rgb(var(--brand-800-rgb, 16 76 91) / <alpha-value>)',
          900: 'rgb(var(--brand-900-rgb, 13 57 69) / <alpha-value>)',
          950: 'rgb(var(--brand-950-rgb, 8 39 48) / <alpha-value>)',
        },
        // 与 brand 同源，保持一致
        primary: {
          50: 'rgb(var(--brand-50-rgb, 239 250 251) / <alpha-value>)',
          100: 'rgb(var(--brand-100-rgb, 219 243 245) / <alpha-value>)',
          200: 'rgb(var(--brand-200-rgb, 182 230 236) / <alpha-value>)',
          300: 'rgb(var(--brand-300-rgb, 143 215 224) / <alpha-value>)',
          400: 'rgb(var(--brand-400-rgb, 111 202 216) / <alpha-value>)',
          500: 'rgb(var(--brand-500-rgb, 80 189 207) / <alpha-value>)',
          600: 'rgb(var(--brand-600-rgb, 33 131 151) / <alpha-value>)',
          700: 'rgb(var(--brand-700-rgb, 22 99 116) / <alpha-value>)',
          800: 'rgb(var(--brand-800-rgb, 16 76 91) / <alpha-value>)',
          900: 'rgb(var(--brand-900-rgb, 13 57 69) / <alpha-value>)',
          950: 'rgb(var(--brand-950-rgb, 8 39 48) / <alpha-value>)',
        },
        logo: {
          50: '#effafb',
          100: '#dbf3f5',
          200: '#b6e6ec',
          300: '#8fd7e0',
          400: '#6fcad8',
          500: '#50bdcf',
          600: '#218397',
          700: '#166374',
          800: '#104c5b',
          900: '#0d3945',
          950: '#082730',
        },
        /*
         * shadcn 语义 token：数值逐项映射自当前设计（notion-warm 暖灰系 + brand 青），
         * 因此 shadcn 原语组件（Dialog/Button/Dropdown…）会直接长成本应用的模样，
         * 这就是「全局换 shadcn 而 UI 无差异」的关键 —— 换内核不换皮。
         * 新代码无法直接判断语义名时仍可用 warm.* 直写，两条路颜色同源。
         */
        border: '#E6E6E3',
        input: '#E6E6E3',
        ring: '#218397',
        background: '#FFFFFF',
        foreground: '#191918',
        primary: {
          DEFAULT: '#1C1C1C',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#FBFBFA',
          foreground: '#191918',
        },
        muted: {
          DEFAULT: '#FBFBFA',
          foreground: '#787774',
        },
        accent: {
          DEFAULT: '#F3F3F1',
          foreground: '#191918',
        },
        destructive: {
          DEFAULT: '#e11d48',
          foreground: '#FFFFFF',
        },
        popover: {
          DEFAULT: '#FFFFFF',
          foreground: '#191918',
        },
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#191918',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', 'monospace'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Inter', 'sans-serif'],
      },
      /*
       * 项目用的是 Tailwind v3，而 v3 的阴影刻度里没有 xs/2xs（xs 是 v4 才加的）。
       * 代码里出现的 shadow-2xs / shadow-xs 因此全都静默失效，只能写任意值。
       * 这里补两个符合本项目「细边框 + 极淡投影」调性的档位，供新 UI 使用。
       */
      boxShadow: {
        '2xs': '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      },
      /*
       * shadcn 原语的进出动画。Radix 自带 Presence（退出动画播完才真正卸载），
       * 所以 data-[state=closed] 这几个 keyframe 是真实生效的，不需要再配
       * usePresence 那套手动挂卸机制。
       *
       * ⚠️ 关键帧必须自带 translate(-50%, -50%)：DialogContent 用
       * left/top-1/2 + translate 居中，而 CSS 动画期间 transform 会整条
       * 覆盖静态声明 —— 若关键帧只写 scale，动画被后台节流冻结在首帧时
       * （Electron 窗口被遮挡 / 标签页后台），拼合的 translate 就会丢失，
       * 弹窗原地钉在 (50%,50%) 向右下铺出去。fill-mode 不救这个：暂停就是没有终态。
       */
      keyframes: {
        'overlay-show': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'overlay-hide': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'content-show': {
          from: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.97) translateY(4px)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1) translateY(0)' },
        },
        'content-hide': {
          from: { opacity: '1', transform: 'translate(-50%, -50%) scale(1) translateY(0)' },
          to: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.97) translateY(4px)' },
        },
        'popover-show': {
          from: { opacity: '0', transform: 'scale(0.96) translateY(-3px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'popover-hide': {
          from: { opacity: '1', transform: 'scale(1) translateY(0)' },
          to: { opacity: '0', transform: 'scale(0.96) translateY(-3px)' },
        },
      },
      animation: {
        'overlay-show': 'overlay-show 180ms cubic-bezier(0.22,1,0.36,1)',
        'overlay-hide': 'overlay-hide 150ms ease-in',
        'content-show': 'content-show 180ms cubic-bezier(0.22,1,0.36,1)',
        'content-hide': 'content-hide 150ms ease-in',
        'popover-show': 'popover-show 140ms cubic-bezier(0.22,1,0.36,1)',
        'popover-hide': 'popover-hide 120ms ease-in',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
