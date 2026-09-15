/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
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
        /*
         * 深色模式表面色板：随深色主题（极夜/东京暗夜/德古拉/幽静深林/暮色暖咖）自适应调整
         */
        dark: {
          bg: 'rgb(var(--theme-dark-bg-rgb, 9 10 15) / <alpha-value>)',
          panel: 'rgb(var(--theme-dark-panel-rgb, 18 20 26) / <alpha-value>)',
          sidebar: 'rgb(var(--theme-dark-sidebar-rgb, 14 16 21) / <alpha-value>)',
          border: 'rgb(var(--theme-dark-border-rgb, 35 39 51) / <alpha-value>)',
          hover: 'rgb(var(--theme-dark-hover-rgb, 27 31 43) / <alpha-value>)',
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
        /*
         * 点缀色 = logo 的青蓝 #50BDCF，精确落在 500 档。
         * 只用在品牌标识处（侧栏 logo、首屏、载入态），不做大面积主色 ——
         * 青色系天生亮度高，#50BDCF 上压白字只有 2.2:1，撑不起主按钮，
         * 所以需要青底白字时统一退到 600 档（#218397，4.4:1），700 留给 hover。
         */
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
        }
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
      }
    },
  },
  plugins: [],
}
