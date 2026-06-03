/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  output: 'export',
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ['192.168.1.168'],
  env: {
    IMPERIAL_LOGS: process.env.IMPERIAL_LOGS || "",
    MOCK: process.env.MOCK || "",
    VERBOSE: process.env.VERBOSE || ""
  }
};

export default nextConfig;
