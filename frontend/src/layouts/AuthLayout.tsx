import { Outlet } from 'react-router-dom';
import { Flex, Typography } from 'antd';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

/**
 * Sign-in shell.
 *
 * The previous version used a three-stop lavender/pink gradient background plus a
 * gradient logo tile with a coloured glow. Decorative gradients are the clearest
 * "generic template" signal, so this is a plain, calm surface: the form is the only
 * thing on screen worth attention.
 */
export default function AuthLayout() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: color.canvas,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.xl,
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <Flex vertical align="center" gap={space.md} style={{ marginBottom: space.xxl }}>
          <div
            aria-hidden
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.xl,
              background: color.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: color.textOnAccent,
              fontWeight: font.weight.bold,
              fontSize: 17,
              letterSpacing: '-0.02em',
            }}
          >
            UP
          </div>
          <div style={{ textAlign: 'center' }}>
            <Text
              strong
              style={{
                fontSize: font.size.title3,
                display: 'block',
                lineHeight: 1.25,
                letterSpacing: '-0.02em',
                color: color.text,
              }}
            >
              UP Heritage Tours
            </Text>
            <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
              Sign in to continue
            </Text>
          </div>
        </Flex>

        <Outlet />
      </div>
    </div>
  );
}
