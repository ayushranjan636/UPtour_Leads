import type { ThemeConfig } from 'antd';
import { color, font, grey, material, radius, shadow } from './tokens';

/**
 * Ant Design theme mapped onto the Apple-inspired tokens in `tokens.ts`.
 *
 * Deliberate departures from the previous configuration:
 *  - System font stack instead of Inter, so text renders in the OS face.
 *  - One blue accent replaces the indigo/violet pair; gradients are gone.
 *  - Tighter radii and softer shadows: surfaces sit close to the page rather than
 *    floating as heavily-shadowed cards.
 *  - Control height 36 (was 40) with a 15px menu/label rhythm — denser, closer to
 *    macOS, while list rows stay >=44px for comfortable targets.
 */
const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: color.accent,
    colorSuccess: color.success,
    colorWarning: color.warning,
    colorError: color.danger,
    colorInfo: color.info,
    colorLink: color.accent,

    colorBgBase: color.surface,
    colorBgLayout: color.canvas,
    colorBgContainer: color.surface,
    colorBgElevated: color.elevated,
    colorFillQuaternary: color.fill,

    colorTextBase: color.text,
    colorText: color.text,
    colorTextSecondary: color.textSecondary,
    colorTextTertiary: color.textTertiary,
    colorTextDescription: color.textSecondary,
    // Ant's defaults for these are alpha-based (rgba(...,0.25)), which measured
    // 1.7:1 against white — placeholders and disabled field values were effectively
    // invisible. Both are pinned to the AA-passing grey instead.
    colorTextPlaceholder: color.textSecondary,
    colorTextDisabled: color.textSecondary,

    colorBorder: color.separatorOpaque,
    colorBorderSecondary: color.separator,

    borderRadius: radius.md,
    borderRadiusLG: radius.xl,
    borderRadiusSM: radius.sm,
    borderRadiusXS: radius.sm,

    fontFamily: font.family,
    fontFamilyCode: font.mono,
    fontSize: font.size.body,
    fontSizeSM: font.size.footnote,
    fontSizeLG: font.size.callout,
    fontSizeHeading1: font.size.title1,
    fontSizeHeading2: font.size.title2,
    fontSizeHeading3: font.size.title3,
    fontSizeHeading4: font.size.headline,
    fontSizeHeading5: font.size.callout,
    lineHeight: 1.47,

    controlHeight: 36,
    controlHeightLG: 44,
    controlHeightSM: 28,
    lineWidth: 1,

    boxShadow: shadow.md,
    boxShadowSecondary: shadow.lg,
    boxShadowTertiary: shadow.sm,

    // Keep motion brief; global.css disables it under prefers-reduced-motion.
    motionDurationFast: '0.12s',
    motionDurationMid: '0.2s',
    motionDurationSlow: '0.28s',

    paddingLG: 24,
    paddingMD: 16,
    paddingSM: 12,
    paddingXS: 8,
    wireframe: false,
  },
  components: {
    Layout: {
      // Navigation chrome is painted in AppLayout with the glass material; these
      // values are the opaque fallback beneath it.
      siderBg: material.fallback,
      headerBg: material.fallback,
      bodyBg: color.canvas,
      headerHeight: 52,
      headerPadding: '0 20px',
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemSelectedBg: color.accentSoft,
      itemSelectedColor: color.accent,
      itemHoverBg: 'rgba(60, 60, 67, 0.06)',
      itemHoverColor: color.text,
      itemColor: color.textSecondary,
      itemActiveBg: color.accentSoft,
      iconSize: 16,
      iconMarginInlineEnd: 10,
      itemHeight: 34,
      itemMarginInline: 6,
      itemMarginBlock: 2,
      itemBorderRadius: radius.md,
      itemPaddingInline: 10,
      fontSize: font.size.footnote,
      collapsedIconSize: 18,
    },
    Button: {
      // Flat primaries: a coloured shadow under every button reads as bootstrap-era
      // styling and competes with real elevation.
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      fontWeight: font.weight.medium,
      paddingInline: 14,
      defaultBg: color.surface,
      defaultBorderColor: color.separatorOpaque,
      defaultColor: color.text,
    },
    Card: {
      borderRadiusLG: radius.xl,
      paddingLG: 20,
      headerHeight: 48,
      headerFontSize: font.size.callout,
      colorBorderSecondary: color.separator,
    },
    Table: {
      headerBg: color.fill,
      headerColor: color.textSecondary,
      headerSplitColor: 'transparent',
      rowHoverBg: 'rgba(60, 60, 67, 0.035)',
      rowSelectedBg: color.accentSofter,
      rowSelectedHoverBg: color.accentSoft,
      borderColor: color.separator,
      cellPaddingBlock: 12,
      cellPaddingInline: 16,
      headerBorderRadius: 0,
      fontSize: font.size.body,
    },
    Input: {
      activeBorderColor: color.accent,
      hoverBorderColor: grey[400],
      activeShadow: `0 0 0 3px ${color.accentRing}`,
      paddingBlock: 6,
      paddingInline: 11,
      colorBgContainer: color.surface,
    },
    InputNumber: {
      activeBorderColor: color.accent,
      hoverBorderColor: grey[400],
      activeShadow: `0 0 0 3px ${color.accentRing}`,
    },
    Select: {
      optionSelectedBg: color.accentSoft,
      optionSelectedColor: color.accent,
      optionSelectedFontWeight: font.weight.medium,
      activeBorderColor: color.accent,
      hoverBorderColor: grey[400],
      activeOutlineColor: color.accentRing,
      borderRadius: radius.md,
    },
    Tag: {
      borderRadiusSM: radius.sm,
      defaultBg: color.fill,
      defaultColor: color.textSecondary,
      fontSizeSM: font.size.caption,
      lineHeightSM: 1.6,
    },
    Tabs: {
      inkBarColor: color.accent,
      itemSelectedColor: color.text,
      itemHoverColor: color.text,
      itemColor: color.textSecondary,
      titleFontSize: font.size.body,
      horizontalItemGutter: 24,
      horizontalItemPadding: '10px 0',
    },
    Steps: {
      colorPrimary: color.accent,
    },
    Modal: {
      borderRadiusLG: radius.xxl,
      contentBg: color.elevated,
      headerBg: color.elevated,
      titleFontSize: font.size.headline,
      paddingContentHorizontalLG: 24,
    },
    Drawer: {
      colorBgElevated: color.elevated,
      paddingLG: 20,
    },
    Popover: {
      colorBgElevated: color.elevated,
      borderRadiusLG: radius.xl,
    },
    Dropdown: {
      colorBgElevated: color.elevated,
      borderRadiusLG: radius.lg,
      controlItemBgHover: 'rgba(60, 60, 67, 0.06)',
      paddingBlock: 5,
    },
    Tooltip: {
      colorBgSpotlight: 'rgba(28, 28, 30, 0.92)',
      borderRadius: radius.md,
      fontSize: font.size.footnote,
    },
    Progress: {
      defaultColor: color.accent,
      remainingColor: color.fillStrong,
    },
    Badge: {
      textFontSize: font.size.caption,
      textFontSizeSM: 10,
    },
    Avatar: {
      // Flat tint rather than a gradient — see AppLayout.
      colorTextPlaceholder: color.accent,
    },
    Segmented: {
      itemSelectedBg: color.surface,
      itemSelectedColor: color.text,
      trackBg: color.fillStrong,
      borderRadius: radius.md,
    },
    Form: {
      labelColor: color.text,
      labelFontSize: font.size.footnote,
      verticalLabelPadding: '0 0 6px',
      itemMarginBottom: 18,
    },
    Empty: {
      colorTextDescription: color.textSecondary,
    },
    Statistic: {
      titleFontSize: font.size.footnote,
      contentFontSize: font.size.title2,
    },
    Descriptions: {
      labelColor: color.textSecondary,
      titleColor: color.text,
    },
    List: {
      itemPadding: '12px 16px',
    },
    Divider: {
      colorSplit: color.separator,
    },
    Alert: {
      borderRadiusLG: radius.lg,
    },
    Spin: {
      colorPrimary: color.accent,
    },
    // Toasts default to Ant's bright #52C41A, the one element that ignored the
    // palette. Pin the feedback surfaces to the theme's status colours.
    Message: {
      colorSuccess: color.success,
      colorError: color.danger,
      colorWarning: color.warning,
      colorInfo: color.accent,
      contentBg: color.elevated,
      borderRadiusLG: radius.lg,
    },
    Notification: {
      colorSuccess: color.success,
      colorError: color.danger,
      colorWarning: color.warning,
      colorInfo: color.accent,
    },
    Result: {
      colorSuccess: color.success,
      colorError: color.danger,
    },
    Switch: {
      handleSize: 18,
      trackHeight: 22,
      trackMinWidth: 40,
    },
  },
};

export default themeConfig;
