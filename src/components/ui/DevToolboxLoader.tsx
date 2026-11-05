import React from 'react';

export interface DevToolboxLoaderProps {
  /** 图标尺寸 (px) */
  size?: number;
  /** 主状态标题（如：正在美化 JSON... / 等待美化操作） */
  title?: string;
  /** 副标题说明 */
  subtitle?: string;
  /** 外层容器自定义类名 */
  className?: string;
}

export const DevToolboxLoader: React.FC<DevToolboxLoaderProps> = ({
  size = 120,
  title = '正在美化并校验 JSON...',
  subtitle = '解析 AST 语法树与缩进层级中',
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-center justify-center select-none ${className}`}>
      <div
        style={{ width: size, height: size }}
        className="relative flex items-center justify-center"
      >
        <svg viewBox="0 0 240 240" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="dev-orange-grad" x1="15%" y1="5%" x2="85%" y2="95%">
              <stop offset="0%" stopColor="#FFD7A8" />
              <stop offset="45%" stopColor="#FF9E75" />
              <stop offset="100%" stopColor="#FF6B4A" />
            </linearGradient>
            <linearGradient id="dev-orange-flap" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FF8563" />
              <stop offset="100%" stopColor="#E04F33" />
            </linearGradient>
            <linearGradient id="dev-mint-grad" x1="0%" y1="15%" x2="95%" y2="90%">
              <stop offset="0%" stopColor="#7CE8C8" stopOpacity="0.92" />
              <stop offset="60%" stopColor="#52D1C6" stopOpacity="0.88" />
              <stop offset="100%" stopColor="#38B2CE" stopOpacity="0.85" />
            </linearGradient>
            <linearGradient id="dev-blue-grad" x1="15%" y1="0%" x2="90%" y2="95%">
              <stop offset="0%" stopColor="#8BE2FF" stopOpacity="0.86" />
              <stop offset="48%" stopColor="#4FB0FF" stopOpacity="0.84" />
              <stop offset="100%" stopColor="#5B86F7" stopOpacity="0.88" />
            </linearGradient>
            <linearGradient id="dev-blue-sub" x1="10%" y1="0%" x2="90%" y2="100%">
              <stop offset="0%" stopColor="#5CA9FF" stopOpacity="0.62" />
              <stop offset="100%" stopColor="#8AB8FF" stopOpacity="0.52" />
            </linearGradient>
            <linearGradient id="dev-doc-grad" x1="10%" y1="5%" x2="90%" y2="95%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.97" />
              <stop offset="55%" stopColor="#EBF6FF" stopOpacity="0.94" />
              <stop offset="100%" stopColor="#D6ECFF" stopOpacity="0.92" />
            </linearGradient>
            <linearGradient id="dev-fold-grad" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="60%" stopColor="#E1F0FF" />
              <stop offset="100%" stopColor="#BCE0FF" />
            </linearGradient>
            <linearGradient id="dev-fold-shadow" x1="50%" y1="0%" x2="30%" y2="100%">
              <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.42" />
              <stop offset="100%" stopColor="#60A5FA" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="dev-code-left" x1="0%" y1="15%" x2="100%" y2="90%">
              <stop offset="0%" stopColor="#2575FC" />
              <stop offset="100%" stopColor="#6B46F6" />
            </linearGradient>
            <linearGradient id="dev-code-right" x1="0%" y1="10%" x2="100%" y2="90%">
              <stop offset="0%" stopColor="#4389FF" />
              <stop offset="100%" stopColor="#7E42F5" />
            </linearGradient>
          </defs>

          {/* 1. 左上暖橙珊瑚渐变折翼卡 */}
          <g className="origin-[115px_115px] animate-[layerOrangePop_2.4s_cubic-bezier(0.34,1.56,0.64,1)_infinite]">
            <rect x="64" y="96" width="52" height="52" rx="10" fill="url(#dev-orange-flap)" />
            <path d="M58 128 Q58 136 66 138 L74 122 Z" fill="#D94E34" opacity="0.85" />
            <path d="M58 128 L58 95 Q58 86 66 80 L114 48 Q123 42 132 50 L158 76 L92 128 Z" fill="url(#dev-orange-grad)" />
          </g>

          {/* 2. 左下薄荷青绿磨砂方卡 */}
          <g className="origin-[115px_125px] animate-[layerMintPop_2.4s_cubic-bezier(0.34,1.56,0.64,1)_infinite]">
            <rect x="73" y="109" width="86" height="71" rx="16" fill="url(#dev-mint-grad)" />
          </g>

          {/* 3. 右侧天蓝/宝蓝毛玻璃斜卡 */}
          <g className="origin-[125px_120px] animate-[layerBluePop_2.4s_cubic-bezier(0.34,1.56,0.64,1)_infinite]">
            <rect x="98" y="106" width="77" height="65" rx="15" fill="url(#dev-blue-sub)" />
            <path d="M112 86 L146 63 Q160 54 162 70 L164 102 L178 94 Q183 98 183 106 L183 132 Q183 139 175 135 L112 115 Z" fill="url(#dev-blue-grad)" />
          </g>

          {/* 4. 前景冰白微蓝折角文档 + < > 代码括号 */}
          <g className="origin-[126px_128px] animate-[docCardPop_2.4s_cubic-bezier(0.34,1.45,0.64,1)_infinite]">
            <path
              d="M100 86 H140 C143 86 145 87 147 89 L167 109 C169 111 170 113 170 116 V148 C170 156 164 162 156 162 H100 C92 162 86 156 86 148 V100 C86 92 92 86 100 86 Z"
              fill="url(#dev-doc-grad)"
              stroke="#FFFFFF"
              strokeWidth="2.5"
              className="animate-[docStrokeDraw_2.4s_cubic-bezier(0.65,0,0.35,1)_infinite]"
              style={{ strokeDasharray: 480 }}
            />
            <path d="M141 96 L170 114 L170 128 L138 114 Z" fill="url(#dev-fold-shadow)" className="origin-[156px_96px] animate-[foldFlapFlip_2.4s_cubic-bezier(0.34,1.56,0.64,1)_infinite]" />
            <path
              d="M141 86 C141 92 141 98 141 103 C141 110 146 114 153 114 C159 114 165 114 170 114 L141 86 Z"
              fill="url(#dev-fold-grad)"
              stroke="#FFFFFF"
              strokeWidth="1.5"
              className="origin-[156px_96px] animate-[foldFlapFlip_2.4s_cubic-bezier(0.34,1.56,0.64,1)_infinite]"
            />
            <path
              d="M119 115 L103 129 L119 143"
              fill="none"
              stroke="url(#dev-code-left)"
              strokeWidth="10.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="origin-[105px_132px] animate-[codeBracketDrawLeft_2.4s_cubic-bezier(0.34,1.4,0.64,1)_infinite]"
              style={{ strokeDasharray: 90 }}
            />
            <path
              d="M137 115 L153 129 L137 143"
              fill="none"
              stroke="url(#dev-code-right)"
              strokeWidth="10.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="origin-[145px_132px] animate-[codeBracketDrawRight_2.4s_cubic-bezier(0.34,1.4,0.64,1)_infinite]"
              style={{ strokeDasharray: 90 }}
            />
          </g>
        </svg>
      </div>

      {title && <p className="mt-3 text-xs font-semibold text-stone-700">{title}</p>}
      {subtitle && <p className="mt-1 text-[11px] text-stone-400">{subtitle}</p>}

      <style>{`
        @keyframes layerOrangePop {
          0%, 8% { transform: translate(18px, 22px) scale(0.45) rotate(12deg); opacity: 0; }
          32%, 80% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
          96%, 100% { transform: translate(10px, 14px) scale(0.75) rotate(6deg); opacity: 0; }
        }
        @keyframes layerMintPop {
          0%, 14% { transform: translate(16px, -14px) scale(0.5); opacity: 0; }
          38%, 80% { transform: translate(0, 0) scale(1); opacity: 1; }
          96%, 100% { transform: translate(10px, -8px) scale(0.75); opacity: 0; }
        }
        @keyframes layerBluePop {
          0%, 20% { transform: translate(-18px, 16px) scale(0.5) rotate(-14deg); opacity: 0; }
          44%, 80% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
          96%, 100% { transform: translate(-12px, 10px) scale(0.75) rotate(-8deg); opacity: 0; }
        }
        @keyframes docCardPop {
          0%, 24% { transform: scale(0.68) translateY(12px); opacity: 0; }
          48% { transform: scale(1.03) translateY(-2px); opacity: 1; }
          56%, 82% { transform: scale(1) translateY(0px); opacity: 1; }
          96%, 100% { transform: scale(0.82) translateY(8px); opacity: 0; }
        }
        @keyframes docStrokeDraw {
          0%, 22% { stroke-dashoffset: 480; opacity: 0.3; }
          52%, 82% { stroke-dashoffset: 0; opacity: 1; }
          100% { stroke-dashoffset: -480; opacity: 0; }
        }
        @keyframes foldFlapFlip {
          0%, 34% { transform: scale(0.1) rotate(-35deg); opacity: 0; }
          58% { transform: scale(1.08) rotate(3deg); opacity: 1; }
          66%, 82% { transform: scale(1) rotate(0deg); opacity: 1; }
          96%, 100% { transform: scale(0.5) rotate(-15deg); opacity: 0; }
        }
        @keyframes codeBracketDrawLeft {
          0%, 36% { stroke-dashoffset: 90; transform: translateX(6px); opacity: 0; }
          60% { stroke-dashoffset: 0; transform: translateX(-3px); opacity: 1; }
          70%, 82% { stroke-dashoffset: 0; transform: translateX(0px); opacity: 1; }
          96%, 100% { stroke-dashoffset: -90; transform: translateX(4px); opacity: 0; }
        }
        @keyframes codeBracketDrawRight {
          0%, 40% { stroke-dashoffset: 90; transform: translateX(-6px); opacity: 0; }
          64% { stroke-dashoffset: 0; transform: translateX(3px); opacity: 1; }
          72%, 82% { stroke-dashoffset: 0; transform: translateX(0px); opacity: 1; }
          96%, 100% { stroke-dashoffset: -90; transform: translateX(-4px); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default DevToolboxLoader;
