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
         * 主色 = indigo，600 档 #4f46e5。
         * 与参考项目 qqlink_fileview 的 --accent 三件套逐字节一致
         * （#4f46e5 / #4338ca / #eef2ff），也是本项目一直以来的主色。
         */
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        dark: {
          bg: '#090a0f',
          panel: '#12141a',
          sidebar: '#0e1015',
          border: '#232733',
          hover: '#1b1f2b',
        },
        // 与 brand 同源，历史上是 indigo 的一份副本
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
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
