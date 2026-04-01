/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // ESLint and its plugins stay in devDependencies for local `npm run lint`;
  // production installs on PaaS often omit devDependencies, which would break `next build`.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
