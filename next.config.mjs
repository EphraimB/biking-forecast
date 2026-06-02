/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  output: 'export',
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ['192.168.1.168'],
};

export default nextConfig;
