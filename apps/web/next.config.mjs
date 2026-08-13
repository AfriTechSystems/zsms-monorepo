/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source — Next compiles them.
  transpilePackages: [
    '@zsms/auth-provider',
    '@zsms/config',
    '@zsms/queue',
    '@zsms/storage',
    '@zsms/types',
    '@zsms/utils',
  ],
}
export default nextConfig
