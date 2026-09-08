/**
 * Cloudinary Node.js SDK configuration module.
 *
 * This module configures and exports the Cloudinary v2 SDK instance for server-side
 * usage throughout the Astro application (API endpoints, SSR, build scripts).
 *
 * Credentials are read from environment variables:
 * - CLOUDINARY_CLOUD_NAME: your Cloudinary product environment identifier
 * - CLOUDINARY_API_KEY: public identifier for your API credentials
 * - CLOUDINARY_API_SECRET: private key used for signed operations and admin calls
 *
 * Note: Never import or execute this module in client-side / browser code to prevent
 * exposing API secrets. For client-side delivery, use standard transformed URLs.
 */
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export { cloudinary };
export default cloudinary;
