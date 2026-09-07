import { db, BlogComment as BlogCommentTable, eq, desc } from "astro:db";
import type { APIRoute } from "astro";
import sanitizeHtml from "sanitize-html";

export const GET: APIRoute = async ({ url }) => {
  const timestamp = new Date().toISOString();
  const slug = url.searchParams.get("slug");

  try {
    if (!slug) {
      console.warn(
        `[${timestamp}] [API GET /api/comments] Missing slug parameter`,
      );
      return new Response(
        JSON.stringify({ error: "Blog post slug parameter is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const comments = await db
      .select()
      .from(BlogCommentTable)
      .where(eq(BlogCommentTable.postSlug, slug))
      .orderBy(desc(BlogCommentTable.createdAt));

    return new Response(JSON.stringify({ comments }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (error) {
    console.error(`[${timestamp}] [API ERROR GET /api/comments]`, error);
    return new Response(JSON.stringify({ error: "Failed to fetch comments" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const timestamp = new Date().toISOString();

  try {
    const data = await request.json();
    const { postSlug, name, email, website, content, parentId } = data;

    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      clientAddress ||
      "127.0.0.1";

    if (!postSlug || !name || !content) {
      console.warn(
        `[${timestamp}] [API POST /api/comments] Validation failed: missing required fields`,
      );
      return new Response(
        JSON.stringify({ error: "postSlug, name, and content are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const cleanName = sanitizeHtml(name.trim(), {
      allowedTags: [],
      allowedAttributes: {},
    }).slice(0, 100);

    const cleanContent = sanitizeHtml(content.trim(), {
      allowedTags: ["b", "i", "em", "strong", "code", "a"],
      allowedAttributes: {
        a: ["href", "target", "rel"],
      },
    }).slice(0, 2000);

    const cleanWebsite = website
      ? sanitizeHtml(website.trim(), {
          allowedTags: [],
          allowedAttributes: {},
        }).slice(0, 200)
      : undefined;

    const cleanEmail = email
      ? sanitizeHtml(email.trim(), {
          allowedTags: [],
          allowedAttributes: {},
        }).slice(0, 150)
      : undefined;

    if (!cleanName || !cleanContent) {
      console.warn(
        `[${timestamp}] [API POST /api/comments] Validation failed: empty cleaned content`,
      );
      return new Response(
        JSON.stringify({ error: "Invalid comment content" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const result = await db
      .insert(BlogCommentTable)
      .values({
        postSlug: postSlug.trim(),
        name: cleanName,
        email: cleanEmail,
        website: cleanWebsite,
        content: cleanContent,
        ipAddress: clientIp,
        parentId: parentId ? Number(parentId) : undefined,
        createdAt: new Date(),
      })
      .returning();

    const created = result[0];

    return new Response(JSON.stringify(created), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(`[${timestamp}] [API ERROR POST /api/comments]`, error);
    return new Response(JSON.stringify({ error: "Failed to post comment" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
