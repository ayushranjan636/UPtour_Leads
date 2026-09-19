import type { ThemeConfig } from 'antd';

const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#4F46E5',
    colorSuccess: '#10B981',
    colorWarning: '#F59E0B',
    colorError: '#EF4444',
    colorInfo: '#4F46E5',
    colorBgBase: '#FFFFFF',
    colorBgLayout: '#F5F7FA',
    colorBorder: '#E5E7EB',
    colorBorderSecondary: '#F0F0F0',
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 8,
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    fontSize: 14,
    fontSizeHeading1: 30,
    fontSizeHeading2: 24,
    fontSizeHeading3: 20,
    fontSizeHeading4: 16,
    controlHeight: 40,
    lineWidth: 1,
    boxShadow:
      '0 1px 3px 0 rgba(0, 0, 0, 0.04), 0 1px 2px -1px rgba(0, 0, 0, 0.03)',
    boxShadowSecondary:
      '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.03)',
    colorTextBase: '#111827',
    colorTextSecondary: '#6B7280',
    colorBgContainer: '#FFFFFF',
    paddingLG: 24,
    paddingMD: 16,
    paddingSM: 12,
    paddingXS: 8,
  },
  components: {
    Layout: {
      siderBg: '#FFFFFF',
      headerBg: '#FFFFFF',
      bodyBg: '#F5F7FA',
      triggerBg: '#F0F0F0',
      triggerColor: '#6B7280',
    },
    Menu: {
      itemBg: 'transparent',
      itemSelectedBg: '#EEF2FF',
      itemSelectedColor: '#4F46E5',
      itemHoverBg: '#F9FAFB',
      itemColor: '#6B7280',
      itemActiveBg: '#EEF2FF',
      iconSize: 18,
      itemHeight: 44,
      itemMarginInline: 8,
      itemBorderRadius: 10,
    },
    Button: {
      primaryShadow: '0 2px 4px rgba(79, 70, 229, 0.2)',
      fontWeight: 500,
    },
    Card: {
      borderRadiusLG: 14,
      paddingLG: 24,
    },
    Table: {
      headerBg: '#FAFBFC',
      headerColor: '#6B7280',
      rowHoverBg: '#F9FAFB',
      borderColor: '#F0F0F0',
    },
    Input: {
      activeBorderColor: '#4F46E5',
      hoverBorderColor: '#A5B4FC',
    },
    Select: {
      optionSelectedBg: '#EEF2FF',
    },
    Tag: {
      borderRadiusSM: 6,
    },
    Tabs: {
      inkBarColor: '#4F46E5',
      itemSelectedColor: '#4F46E5',
      itemHoverColor: '#6366F1',
    },
    Steps: {
      colorPrimary: '#4F46E5',
    },
  },
};

export default themeConfig;
