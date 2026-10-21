import { useEffect, useRef, useState } from 'react'
import Lightbox, { type ZoomRef } from 'yet-another-react-lightbox'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'

export interface LightboxImage {
  src: string
  alt?: string
}

interface ImageLightboxProps {
  /** 同一组里的所有图片，左右键在它们之间切换 */
  images: LightboxImage[]
  /** 当前打开的是哪一张；-1 表示关闭 */
  index: number
  onClose: () => void
}

/**
 * 窗口内的图片预览：全屏遮罩 + 左右切换 + 滚轮 / 按钮放大缩小。
 * 底层用 yet-another-react-lightbox，只做了一层样式与状态的适配。
 */
export default function ImageLightbox({ images, index, onClose }: ImageLightboxProps) {
  // 用户左右切换时 Lightbox 会回调 view，这里记下来，避免被外部的 index 拉回去
  const [current, setCurrent] = useState(index)
  useEffect(() => {
    if (index >= 0) setCurrent(index)
  }, [index])

  // 单击图片：在原始大小与 2 倍之间切换（双击、滚轮、工具栏按钮照常可用）
  const zoomRef = useRef<ZoomRef>(null)
  const toggleZoom = () => {
    const zoom = zoomRef.current
    if (!zoom || zoom.disabled) return
    if (zoom.zoom > zoom.minZoom + 0.01) zoom.changeZoom(zoom.minZoom)
    else zoom.changeZoom(2)
  }

  return (
    <Lightbox
      open={index >= 0}
      close={onClose}
      index={current}
      slides={images.map((image) => ({ src: image.src, alt: image.alt }))}
      on={{ view: ({ index: next }) => setCurrent(next), click: toggleZoom }}
      plugins={[Zoom]}
      zoom={{ ref: zoomRef, maxZoomPixelRatio: 4, scrollToZoom: true }}
      controller={{ closeOnBackdropClick: true }}
      styles={{ container: { backgroundColor: 'rgba(15, 23, 42, 0.9)' } }}
      carousel={{ padding: 0 }}
      animation={{ fade: 180 }}
    />
  )
}
