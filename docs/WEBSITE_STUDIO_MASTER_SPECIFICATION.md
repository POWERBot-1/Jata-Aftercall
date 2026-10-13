# JATA AFTERCALL — WEBSITE STUDIO: JATA IMMERSIVE WEBSITE ENGINE — MASTER ENGINEERING + AI + UX + PERFORMANCE BUILD SPECIFICATION

Source: the owner's build-and-release directive supplied on 2026-10-11. The original specification below is preserved in full, including Sections 0–107 and the EXECUTION DIRECTIVE. Delivery status belongs in WEBSITE_STUDIO_RELEASE_PLAN.md and WEBSITE_STUDIO_RELEASE_REPORT.md, not in this source specification. The supplied numbering contains 108 section blocks (0 through 107 inclusive), despite being described as “107 sections”; all are retained. The final caution was supplied as the incomplete line `CAUTION!!! GENER`; it is retained without inventing its missing continuation. Part B's engineering and release controls govern implementation of this long-term vision; conflicts are recorded explicitly in the release plan.

```text
JATA AFTERCALL — WEBSITE STUDIO

npm install motion (INSTALL IT IN JATA AFTERCALL STUDIO)

JATA IMMERSIVE WEBSITE ENGINE

MASTER ENGINEERING + AI + UX + PERFORMANCE BUILD SPECIFICATION


---

0. MANDATORY PROJECT BOUNDARY

You are upgrading the EXISTING:

JATA AFTERCALL

Repository:

POWERBot-1/Jata-Aftercall

Do NOT create a separate application.

Do NOT replace the existing architecture.

Do NOT migrate away from:

- Next.js
- Vercel
- Neon PostgreSQL
- Prisma
- existing authentication
- existing tenant model
- existing Paystack integration
- existing POS
- existing AI Front Desk
- existing Website Studio
- existing WhatsApp/Call/Directions functionality

The new system must be an evolution of Website Studio into:

JATA IMMERSIVE WEBSITE ENGINE

The existing JATA AFTERCALL business platform remains the source of truth.

The new engine becomes the experience layer.


---

1. PRODUCT VISION

JATA must move beyond:

«"AI website builder"»

into:

«"AI-generated interactive digital business experience."»

A JATA customer should be able to provide:

- business name
- business category
- description
- products
- services
- prices
- business photos
- logo
- location
- WhatsApp number
- phone number
- offers
- opening hours
- customer instructions
- brand preferences

and JATA should automatically transform that information into a unique:

- visual identity
- website structure
- layout
- imagery
- storytelling sequence
- animations
- interaction model
- product presentation
- CTA strategy
- commerce journey
- mobile experience

WITHOUT requiring the customer to understand:

- HTML
- CSS
- JavaScript
- Three.js
- WebGL
- WebGPU
- GSAP
- shaders
- 3D
- UX design
- typography
- responsive design
- image editing
- animation

The owner provides the business.

JATA creates the experience.


---

2. CORE ARCHITECTURE

Implement this architecture:

JATA AFTERCALL
                           │
                           ▼
                ┌────────────────────┐
                │ JATA WEBSITE STUDIO│
                └──────────┬─────────┘
                           │
                     EXPERIENCE JSON
                           │
                           ▼
             ┌──────────────────────────┐
             │ JATA IMMERSIVE WEBSITE   │
             │          ENGINE          │
             └────────────┬─────────────┘
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
        LITE            MOTION          IMMERSIVE
      HTML/CSS        GSAP/CSS        Three.js
      Minimal JS      Motion          WebGL/WebGPU
          │               │                │
          └───────────────┼────────────────┘
                          ▼
                BUSINESS EXPERIENCE
                          │
     ┌────────────────────┼────────────────────┐
     ▼                    ▼                    ▼
  PRODUCTS             SERVICES             CONTENT
     │                    │                    │
     └────────────────────┼────────────────────┘
                          ▼
                   JATA COMMERCE
                          │
      ┌───────────────────┼───────────────────┐
      ▼                   ▼                   ▼
   WHATSAPP             M-PESA               POS
      │                   │                   │
      └───────────────────┼───────────────────┘
                          ▼
                   AI FRONT DESK
                          │
                          ▼
                      ASK JATA


---

3. THREE RENDERING MODES

Every generated JATA website MUST support three rendering tiers.

MODE A — LITE

Target:

- older Android phones
- low-memory devices
- slow connections
- reduced data environments
- accessibility
- browsers without WebGL
- battery-constrained devices

Technology:

- Next.js
- semantic HTML
- CSS
- optimized images
- minimal JavaScript
- no mandatory 3D

Characteristics:

- instant content availability
- static/SSR-first
- optimized image loading
- minimal animation
- full commerce functionality

The site must remain completely usable in Lite mode.


---

MODE B — MOTION

This becomes the DEFAULT target for normal smartphones.

Technology:

- Next.js
- CSS animations
- GSAP
- IntersectionObserver
- scroll-driven choreography
- responsive media
- micro-interactions

Examples:

- cinematic hero reveal
- staggered product appearance
- image parallax
- scroll storytelling
- animated menus
- product transitions
- card transformations
- magnetic CTA effects
- smooth section transitions
- animated counters
- interactive galleries

The experience should feel premium without requiring 3D.


---

MODE C — IMMERSIVE

Target capable smartphones, tablets and desktops.

Technology:

- Three.js
- WebGL
- WebGPU capability path
- GLB/glTF
- Draco/Meshopt
- KTX2/Basis textures
- shaders
- instancing
- selective physics
- post-processing only where justified

Examples:

- 3D product presentation
- 3D showroom
- interactive property
- virtual environment
- product configurator
- interactive map
- spatial storytelling
- immersive hero
- 3D packaging
- product rotation
- environment transitions

IMMERSIVE MUST NEVER BE REQUIRED FOR BASIC BUSINESS FUNCTIONALITY.

If it fails:

3D failure
↓
Motion experience
↓
2D image
↓
Normal business website

The customer must never lose:

- product information
- price
- WhatsApp
- Call
- Directions
- Order
- Booking
- M-Pesa
- POS integration
- ASK JATA


---

4. CAPABILITY DETECTION

Create:

ExperienceCapabilityDetector

Evaluate:

- WebGL availability
- WebGPU availability
- device memory when available
- hardware concurrency
- viewport
- connection information when available
- reduced-motion preference
- browser capability
- estimated rendering performance

DO NOT rely on device model names alone.

Use progressive runtime testing.

Create a capability score.

Example:

0–30   → LITE
31–65  → MOTION
66–100 → IMMERSIVE

The thresholds must be configurable.

Never expose technical complexity to the customer.


---

5. BUSINESS EXPERIENCE SCHEMA

Create a canonical experience representation.

Example conceptual schema:

BusinessExperience {
version
tenantId

identity {
businessName
category
description
location
phone
whatsapp
logo
}

brand {
visualStyle
primaryColor
secondaryColor
accentColor
typography
radius
density
photographyStyle
}

products[]
services[]
offers[]
testimonials[]
locations[]
stories[]

experience {
mode
templateFamily
hero
navigation
scenes
interactions
motion
immersive
sound
accessibility
}

commerce {
whatsapp
call
directions
booking
ordering
mpesa
pos
}

ai {
generated
generationVersion
artDirection
imagePrompts
contentStrategy
}
}

Do NOT store arbitrary executable JavaScript in this schema.

The schema contains SAFE CONFIGURATION.


---

6. EXPERIENCE RECIPE ENGINE

Build a reusable library of safe experience primitives.

Minimum initial recipes:

Hero

- HeroReveal
- CinematicHero
- SplitHero
- ProductHero
- EditorialHero
- ImmersiveHero
- VideoHero
- ImageMorphHero

Product

- ProductReveal
- ProductZoom
- ProductOrbit
- ProductStack
- ProductCarousel
- ProductConfigurator
- ProductComparison
- ProductStory
- Product360

Content

- ScrollStory
- ImageParallax
- HorizontalGallery
- BeforeAfter
- StoryTimeline
- EditorialGrid
- MagazineLayout
- FullscreenGallery

Services

- ServiceCards
- ServiceReveal
- ServiceJourney
- BookingFlow
- BeforeAfterService
- SpecialistProfile

Location

- LocationReveal
- InteractiveMap
- NeighborhoodStory
- DirectionsReveal

Commerce

- WhatsAppOrder
- M-PesaCTA
- ProductOrder
- BookingCTA
- OfferCountdown
- CartDrawer
- POSBridge

Immersive

- 3DShowroom
- VirtualTour
- ProductOrbit
- InteractiveEnvironment
- InteractiveFloorPlan
- ProductConfigurator
- SpatialGallery


---

7. CRITICAL UNIQUENESS REQUIREMENT

Every generated JATA website must NOT look like another JATA website.

DO NOT simply:

same template
+
different logo
+
different photos

That is prohibited.

Build a:

TEMPLATE DIVERSITY ENGINE

The generator must choose from multiple independent design dimensions.

For example:

business category
+
brand personality
+
customer demographic
+
product type
+
photography style
+
layout family
+
navigation model
+
hero composition
+
interaction model
+
motion language
+
typography
+
color architecture
+
content density
+
commerce pattern
+
immersive capability

The combination should create a distinct experience.


---

8. TEMPLATE FAMILIES

Build many compositional families rather than one universal template.

Initial families should include:

1. Cinematic
2. Editorial
3. Luxury
4. Minimal
5. Magazine
6. Marketplace
7. Product-first
8. Storytelling
9. Spatial
10. Interactive showroom
11. Gallery
12. Split-screen
13. Fullscreen media
14. Scrollytelling
15. Cardless immersive
16. Map-driven
17. Catalog
18. Portfolio
19. Service journey
20. Experimental

The system may expand this library.

Two businesses in the same category should still be able to receive radically different structures.


---

9. ANTI-SIMILARITY ENGINE

Create an internal:

ExperienceDiversityEngine

Before publishing a generated website, calculate similarity against existing generated experiences.

Compare:

- template family
- hero composition
- section ordering
- typography
- color relationships
- interaction recipes
- navigation structure
- animation patterns
- image treatment
- CTA placement
- card usage
- immersive strategy

If the generated experience is too similar to another recent experience:

REGENERATE DESIGN DIRECTION

Do not simply change colors.

Change structural composition.

The objective:

«Every business should feel like it has its own custom-designed digital world.»


---

10. AI ART DIRECTOR

Build:

ExperienceAI

The AI should act as:

- creative director
- UX strategist
- visual designer
- interaction designer
- content architect
- image director
- commerce strategist

Input:

business information
products
services
photos
logo
brand preferences
location
target customer
business objective

Output:

visual language
layout
typography
color system
hero concept
image strategy
interaction strategy
motion strategy
commerce strategy
content hierarchy
experience recipe configuration

The AI must generate configuration rather than arbitrary application code.


---

11. AI-GENERATED PHOTOGRAPHY ENGINE

This is a CORE JATA differentiator.

Build:

JATA IMAGE STUDIO

The system should allow every Website Studio customer to create high-quality custom visual assets even when they have poor or no professional photography.

The user can provide:

- phone photograph
- product photograph
- rough image
- logo
- product description
- desired environment
- desired campaign
- brand style

JATA generates or enhances visual assets suitable for the website.


---

12. IMAGE ENGINE MODES

Create at least these operations:

A. ENHANCE

Improve:

- sharpness
- lighting
- color
- contrast
- composition
- background
- product presentation

without changing the underlying product identity unnecessarily.


---

B. BACKGROUND GENERATION

Example:

Upload ordinary shoe photograph
+
"luxury black studio"

Output:

professional product campaign image.


---

C. PRODUCT CAMPAIGN

Generate:

- hero image
- product close-up
- lifestyle image
- detail image
- social campaign image
- offer image


---

D. PRODUCT CONSISTENCY

CRITICAL.

If a customer uploads a specific product, generated imagery must preserve:

- shape
- branding
- major colors
- packaging
- important physical characteristics

Do not randomly redesign the product.


---

E. MULTI-ANGLE GENERATION

Where technically supported:

front
side
rear
close-up
environmental
lifestyle

These can power product galleries and immersive presentation.


---

13. AI IMAGE ART DIRECTION

JATA should automatically determine:

Photography

- camera perspective
- focal length aesthetic
- depth of field
- composition
- lighting
- environment
- shadows
- reflections

Brand

- palette
- mood
- contrast
- visual density

Business psychology

Restaurant:

appetite
warmth
texture
steam
close-up food detail

Luxury:

negative space
controlled highlights
material detail
precision

Fashion:

editorial
movement
silhouette
texture

Real estate:

architectural geometry
natural light
spatial depth
livability

Salon:

human beauty
hair texture
skin-safe lighting
transformation

The AI should create an image direction automatically.


---

14. IMAGE GENERATION PIPELINE

Implement an abstraction layer:

JATA Image Engine
│
├── Generate
├── Enhance
├── Remove Background
├── Replace Background
├── Relight
├── Crop
├── Upscale
├── Variation
├── Product Consistency
└── Campaign Generation

Do NOT hard-code the Website Studio directly to one external image provider.

Create a provider abstraction:

ImageProvider

with interchangeable adapters.

This allows JATA to evolve as frontier image models improve.


---

15. IMAGE SAFETY + PRODUCT INTEGRITY

Do not allow AI image generation to silently alter commercially important information.

Protect:

- product labels
- prices
- logos
- phone numbers
- packaging text
- business names
- legal information

Generated creative images should be treated as:

creative assets

not authoritative business data.

The database remains authoritative.


---

16. AUTOMATIC IMAGE PIPELINE

When a user uploads a product:

UPLOAD
↓
VALIDATE
↓
ORIGINAL STORED
↓
OPTIMIZE
↓
AI ANALYSIS
↓
BACKGROUND / QUALITY ANALYSIS
↓
GENERATE OPTIONAL VARIATIONS
↓
CREATE WEB-OPTIMIZED VERSIONS
↓
ASSIGN TO EXPERIENCE

The original must remain recoverable.

Never destructively overwrite the original.


---

17. PHOTO UPLOAD MUST WORK ON KENYAN ANDROID

Fix the existing:

«"That image could not be read. Upload a JPG, PNG or WebP photo."»

problem completely.

The upload system must accept common Android camera/gallery formats.

Support:

- JPEG
- PNG
- WebP
- HEIC/HEIF where browser/device permits
- large phone photographs

Implement:

- MIME validation
- extension validation
- actual binary signature validation
- EXIF handling
- orientation correction
- client-side resizing
- compression
- memory-safe decoding
- upload progress
- retry
- graceful errors

Do not assume:

file.type

is always correct.

Android browsers can provide inconsistent metadata.

Where required, inspect file signatures and decode safely.


---

18. CLIENT IMAGE PROCESSING

Before upload:

Original phone image
↓
Read
↓
Correct orientation
↓
Resize
↓
Compress
↓
Generate preview
↓
Upload

Do not upload a 15 MB phone photograph when a 1600–2400px optimized image is sufficient for the website.

The user must see:

Uploading...
Processing...
Ready

not a generic browser error.


---

19. IMAGE CDN ARCHITECTURE

Do NOT store large images directly in Neon.

Use:

Neon
└── metadata
├── tenantId
├── assetId
├── URL
├── dimensions
├── type
└── generation metadata

Object/CDN storage
└── actual binary assets

Use CDN delivery and transformation where available.


---

20. IMAGE FORMATS

Generate appropriate derivatives:

original
thumbnail
mobile
desktop
hero

Prefer:

- AVIF
- WebP

with JPEG fallback where required.

Use responsive image loading.

Never send desktop-sized images unnecessarily to mobile devices.


---

21. MOTION ENGINE

Build:

MotionEngine

using:

- GSAP
- CSS transitions
- IntersectionObserver
- requestAnimationFrame only where necessary

Provide reusable motion presets:

fade
slide
scale
reveal
mask
clip
parallax
stagger
split
blur-reveal
image-pan
text-reveal
magnetic
morph

Respect:

prefers-reduced-motion


---

22. THREE.JS IMMERSIVE ENGINE

Build:

ImmersiveEngine

using Three.js.

Initial capabilities:

- GLB loading
- camera control
- lighting
- environment maps
- object interaction
- animation
- product rotation
- object highlighting
- raycasting
- instancing
- lazy loading

Do NOT build a game engine inside JATA.

The objective is commercial interaction.


---

23. WEBGPU

Create a capability path for:

WebGPU

but do NOT make WebGPU mandatory.

Architecture:

JATA Experience
│
▼
Capability Detector
│
┌────┼─────┐
▼    ▼     ▼
Lite WebGL WebGPU

WebGL remains the safety net.


---

24. GLB / 3D ASSET PIPELINE

Support:

- glTF
- GLB
- Draco
- Meshopt
- KTX2/Basis

Optimize assets before publishing.

Reject unnecessarily huge models.

3D assets must be:

- compressed
- lazy-loaded
- cached
- versioned


---

25. JATA SCENE GRAPH

Implement a safe scene graph:

Scene
│
├── Environment
│   ├── background
│   ├── lighting
│   ├── atmosphere
│   └── effects
│
├── Hero
│   ├── image/model
│   ├── camera
│   ├── animation
│   └── interaction
│
├── Products
│
├── Services
│
├── Story
│
└── Commerce

Scene graph nodes must be configuration objects.

Do not allow customers or AI to inject arbitrary executable code.


---

26. INTERACTION LIBRARY

Build reusable interaction components.

Examples:

TapProduct
HoverProduct
DragProduct
RotateProduct
PinchZoom
ScrollReveal
SwipeGallery
TapToExpand
TapToOrder
TapToBook
TapToWhatsApp
TapToCall
TapToDirections
TapToAskJata

Interactions must work with touch first.

Do NOT design desktop-only interactions.


---

27. MOBILE-FIRST INTERACTION

Kenyan Android is a PRIMARY target.

Design around:

- touch
- thumb reach
- small screens
- intermittent network
- low memory
- battery usage
- limited data
- Android Chrome
- Android WebView-like environments

Avoid making essential interactions dependent on:

- hover
- right click
- keyboard
- precision mouse controls

Every major action must have a touch equivalent.


---

28. "LIVELY" WEBSITE SYSTEM

Every JATA website should feel alive.

But "alive" does NOT mean excessive animation.

Use:

- subtle ambient movement
- responsive buttons
- animated imagery
- intelligent section transitions
- dynamic product presentation
- contextual motion
- interactive cards
- visual feedback
- state changes

Motion must communicate hierarchy.

Do not add animation merely for decoration.


---

29. BUSINESS-SPECIFIC EXPERIENCE GENERATION

JATA AI must recognize business category.

Examples:

RESTAURANT

Generate:

- food photography
- menu storytelling
- dish interaction
- order CTA
- WhatsApp
- M-Pesa
- location
- opening status


---

SALON

Generate:

- transformation gallery
- service journey
- stylist section
- before/after
- booking
- WhatsApp


---

REAL ESTATE

Generate:

- architectural hero
- property gallery
- floor plans
- room navigation
- map
- viewing request


---

FASHION

Generate:

- editorial photography
- product storytelling
- lookbook
- product interactions
- WhatsApp/order


---

GARAGE

Generate:

- service journey
- vehicle/service categories
- diagnostics
- booking
- location


---

HOTEL

Generate:

- immersive property presentation
- room exploration
- amenities
- gallery
- booking
- directions


---

TOURISM

Generate:

- visual storytelling
- location exploration
- itinerary
- gallery
- booking
- WhatsApp


---

30. COMMERCE BRIDGE

Create:

CommerceBridge

Every experience component can invoke business actions.

Supported actions:

CALL
WHATSAPP
DIRECTIONS
ORDER
BOOK
PAY
ASK_JATA
VIEW_PRODUCT
VIEW_SERVICE

Do not duplicate commerce logic inside visual components.

The experience layer calls the existing JATA commerce services.


---

31. M-PESA

The immersive layer must NOT implement its own payment architecture.

It must call the existing JATA payment flow.

Example:

Product
↓
Order
↓
Existing JATA payment flow
↓
M-Pesa / supported payment
↓
Existing verification
↓
Receipt
↓
POS

Never trust client-side payment status.

Server-side verification remains mandatory.


---

32. POS INTEGRATION

An interactive purchase must be capable of flowing into existing POS architecture.

Example:

Website
↓
Product
↓
Order
↓
Payment
↓
Confirmed transaction
↓
POS
↓
Receipt/reconciliation

Maintain tenant isolation throughout.


---

33. ASK JATA INTEGRATION

ASK JATA must become part of the website experience.

Examples:

Customer:
"Do you have chicken today?"

ASK JATA:
"Yes. Chicken is KES 650."

Customer:
"I want one."

ASK JATA:
"Would you like to order now?"

The answer MUST come from actual tenant data.

Never invent:

- prices
- stock
- opening hours
- services
- delivery conditions
- payment information

If data is missing:

I don't have that information yet.

Do not hallucinate.


---

34. AI FRONT DESK ARCHITECTURE

The Website Studio experience and AI Front Desk should share:

Business Data Layer

but maintain strict tenant boundaries.

Architecture:

Visitor
│
▼
Website Experience
│
▼
ASK JATA
│
▼
Tenant-scoped retrieval
│
├── products
├── services
├── stock
├── hours
├── FAQs
├── delivery
└── payment configuration


---

35. AI-GENERATED CONTENT

JATA AI may automatically generate:

- headline
- subheadline
- product descriptions
- service descriptions
- CTA copy
- section titles
- short business story
- SEO title
- SEO description
- image alt text
- offer copy

But the owner must be able to edit everything.

Generated content must never override authoritative:

- price
- stock
- contact
- address
- legal information


---

36. AI EXPERIENCE GENERATION PIPELINE

Implement:

BUSINESS DATA
↓
BUSINESS UNDERSTANDING
↓
CUSTOMER INTENT MODEL
↓
VISUAL ART DIRECTION
↓
LAYOUT GENERATION
↓
TEMPLATE FAMILY
↓
INTERACTION SELECTION
↓
MOTION DESIGN
↓
IMAGE STRATEGY
↓
COMMERCE STRATEGY
↓
RESPONSIVE STRATEGY
↓
EXPERIENCE JSON
↓
VALIDATION
↓
RENDER
↓
PERFORMANCE TEST
↓
PUBLISH


---

37. AI SHOULD GENERATE EXPERIENCES, NOT APPLICATION CODE

This is mandatory.

Do NOT allow:

AI → arbitrary React code → production

Instead:

AI
↓
Experience JSON
↓
Schema validation
↓
Approved components
↓
Renderer
↓
Production

Benefits:

- security
- predictability
- testing
- caching
- performance
- maintainability
- tenant isolation
- rollback


---

38. EXPERIENCE VALIDATION

Before publishing:

Experience JSON
↓
Schema validation
↓
Asset validation
↓
Tenant validation
↓
Commerce validation
↓
Accessibility checks
↓
Performance checks
↓
Mobile rendering checks
↓
Publish

Reject malformed experiences.


---

39. PERFORMANCE BUDGET

Establish budgets.

Initial targets:

Initial JS:
<250 KB compressed where practical

Initial images:
~1 MB target

3D hero:
~2–4 MB target

Additional assets:
lazy-loaded

These are engineering targets.

Measure real-world performance and tune using actual JATA analytics.

Never sacrifice business functionality merely to satisfy an arbitrary byte target.


---

40. PERFORMANCE TECHNIQUES

Use:

- code splitting
- dynamic imports
- lazy loading
- responsive images
- AVIF/WebP
- GLB compression
- Draco
- Meshopt
- KTX2/Basis
- instancing
- CDN caching
- browser caching
- route-level loading
- prefetch only when justified
- asset prioritization

Do NOT load Three.js on Lite websites.

Do NOT load immersive assets before they are needed.


---

41. NEXT.JS ARCHITECTURE

Keep the existing Next.js application.

Use:

- Server Components where appropriate
- Client Components only where interaction requires them
- dynamic imports for heavy experience modules
- SSR/streaming for core content
- route-level code splitting
- server-side tenant resolution
- existing authentication/authorization

Do not turn the entire website into a giant client-side application.


---

42. DATABASE DESIGN

Neon should store:

Tenant
Business
Product
Service
Offer
Experience
ExperienceVersion
ExperienceAsset
ExperienceGeneration
ImageGeneration
ImageVariant
AIArtDirection

Keep large binary objects OUT of Neon.

Add migrations safely.

Do not break existing Prisma models.

Use additive migrations wherever possible.


---

43. VERSIONED EXPERIENCES

Every published experience should have a version.

Example:

Experience v1
Experience v2
Experience v3

Support:

- draft
- preview
- published
- archived

Allow rollback.

Never destroy the previous production experience when generating a new one.


---

44. PREVIEW SYSTEM

Website Studio should support:

EDIT
↓
GENERATE
↓
PREVIEW
↓
MOBILE PREVIEW
↓
DESKTOP PREVIEW
↓
PERFORMANCE CHECK
↓
PUBLISH

Preview must not accidentally modify production.


---

45. "REGENERATE EXPERIENCE"

Add a high-value button:

✨ GENERATE NEW EXPERIENCE

It should create a genuinely different design direction.

Example:

Current:

Luxury editorial

Generate:

Immersive product gallery

without changing the business data.

The customer should be able to explore multiple AI-created directions.


---

46. "MAKE IT MORE..." AI CONTROL

Provide simple controls:

Make it:
[More luxurious]
[More modern]
[More energetic]
[More African]
[More minimal]
[More interactive]
[More cinematic]
[More playful]
[More premium]
[More commercial]
[More immersive]

The AI changes experience configuration rather than rewriting the application.


---

47. "MAKE MY PHOTOS BETTER"

Add:

✨ IMPROVE PHOTOS

AI can:

- enhance lighting
- improve composition
- clean background
- create premium background
- generate lifestyle context
- create product hero
- generate detail crops
- create mobile hero
- create desktop hero

The user can accept/reject every generated asset.


---

48. AI IMAGE WORKSPACE

Build a visual workspace:

Original
│
├── Enhanced
├── Studio
├── Lifestyle
├── Hero
└── Campaign

Actions:

Use
Edit
Regenerate
Delete
Set as Hero
Set as Product Image
Set as Background


---

49. FRONTIER IMAGE CAPABILITY

Do not design the image system around today's single model.

Create an abstraction capable of incorporating better image models over time.

Architecture:

JATA IMAGE ORCHESTRATOR
│
┌──────┼──────┐
▼      ▼      ▼
Provider A
Provider B
Provider C
Internal/Next-gen provider

The system should select the appropriate provider based on:

- task
- quality
- cost
- latency
- image type
- availability

Do not hardwire the entire product to one provider.


---

50. AI IMAGE QUALITY PIPELINE

Generated images should optionally pass through:

generation
↓
identity consistency check
↓
resolution check
↓
composition check
↓
text/logo integrity check
↓
brand consistency
↓
mobile crop generation
↓
desktop crop generation
↓
optimization

Only then should they enter the published experience.


---

51. ACCESSIBILITY

Every experience must maintain:

- semantic HTML
- keyboard navigation
- alt text
- visible focus states
- sufficient contrast
- reduced motion
- accessible CTA labels
- screen-reader-compatible content

Immersive visuals are enhancement, not accessibility barriers.


---

52. SEO

Do not allow immersive rendering to destroy SEO.

Core business information must exist in crawlable HTML.

Support:

- metadata
- Open Graph
- structured data where appropriate
- product information
- local business information
- canonical URLs
- sitemap compatibility


---

53. OFFLINE/LOW-CONNECTION RESILIENCE

If connection quality is poor:

Immersive → Motion → Lite

Do not leave the customer staring at a loading canvas.

Show business content immediately.


---

54. ERROR RECOVERY

Every immersive feature must have fallback states.

Example:

GLB fails
↓
optimized product image

image generation fails
↓
original image

AI fails
↓
manual template generation

WebGL fails
↓
Motion mode

Motion fails
↓
Lite

JATA must degrade gracefully.


---

55. SOUND

Sound should be OPTIONAL.

Never autoplay intrusive audio.

If used:

- muted by default
- user-controlled
- lightweight
- mobile-safe

Use sound only when it materially improves the experience.


---

56. ANALYTICS

Track experience events.

Examples:

experience_loaded
experience_mode
hero_interaction
product_view
product_rotate
gallery_open
service_view
cta_clicked
whatsapp_clicked
call_clicked
directions_clicked
ask_jata_opened
order_started
payment_started
payment_completed
booking_started

Use tenant-scoped analytics.

Do not collect unnecessary personal information.


---

57. PERFORMANCE ANALYTICS

Track:

- selected mode
- load time
- asset load time
- 3D initialization
- WebGL failures
- WebGPU usage
- fallback rate
- interaction latency
- image generation success
- image generation failure
- mobile performance

This data should inform future automatic rendering decisions.


---

58. ADAPTIVE EXPERIENCE

Eventually the engine should learn:

device
+
network
+
previous performance
+
experience complexity

and choose the optimal mode.

For example:

Device capable of WebGL
BUT
previous session was slow

→ use Motion mode.

This is better than blindly trusting hardware capability.


---

59. SECURITY

Absolute tenant isolation.

Every resource must validate:

authenticated user
↓
tenant
↓
resource ownership

Never trust:

- client-supplied tenant IDs
- product IDs
- asset IDs
- experience IDs
- order IDs
- image IDs

Server-side authorization is mandatory.


---

60. AI SECURITY

AI-generated configuration must pass:

schema validation

before execution.

AI must NOT be allowed to generate:

- arbitrary server code
- arbitrary SQL
- arbitrary HTML injection
- arbitrary JavaScript execution
- unauthorized URLs
- unauthorized tenant references


---

61. EXISTING JATA LIFECYCLE MUST REMAIN

Preserve:

CHOOSE PACKAGE
↓
EDIT
↓
PREVIEW
↓
PAY
↓
VERIFY
↓
PUBLISH
↓
LIVE

A customer without the required entitlement must NOT be able to publish a paid Website Studio experience.

Do not weaken entitlement checks.


---

62. HOMEPAGE PLAN POSITIONING

Preserve the requested mobile-first ordering:

149 PLAN
↓
999 PLAN
↓
AI FRONT DESK
↓
WEBSITE STUDIO
↓
POS

Rename the homepage's:

Interactive Business

to:

WEBSITE STUDIO

Website Studio should communicate that it is now the intelligent interactive website creation product.


---

63. WEBSITE STUDIO UX

The customer workflow should become:

START
↓
Tell JATA about your business
↓
Upload photos/logo
↓
AI analyzes business
↓
AI creates visual direction
↓
AI creates website
↓
AI creates/improves imagery
↓
Choose experience
↓
Preview
↓
Regenerate if desired
↓
Edit
↓
Preview mobile
↓
Preview desktop
↓
Pay
↓
Verify
↓
Publish
↓
LIVE

Target:

"A powerful website without needing to know how to build one."


---

64. ONE-CLICK AI GENERATION

Provide:

✨ BUILD MY WEBSITE

The AI should perform:

business analysis
+
content generation
+
image strategy
+
image enhancement
+
layout
+
visual design
+
motion
+
interaction
+
commerce
+
mobile optimization

The owner then reviews the result.


---

65. CATEGORY-SPECIFIC GENERATION

Do not use generic prompts for every business.

Build category-aware art direction.

Examples:

Restaurant → appetite / menu / order
Salon → transformation / booking
Fashion → editorial / catalogue
Real Estate → space / property / viewing
Garage → trust / service / booking
Hotel → hospitality / rooms / booking
Professional Service → credibility / contact
Retail → product / discovery / order
Tourism → exploration / itinerary / booking


---

66. TEMPLATE RANDOMIZATION IS NOT ENOUGH

Do NOT implement:

random template selection

as the uniqueness strategy.

Instead use deterministic creative reasoning.

The AI should choose a design based on:

business identity
+
customer psychology
+
content
+
brand
+
product
+
commerce objective

Two businesses should have different information architectures when appropriate.


---

67. DESIGN DIRECTION OBJECT

Create an internal structure such as:

DesignDirection {
archetype
visualMood
composition
typography
colorSystem
photography
motionLanguage
interactionLanguage
navigationModel
commerceStrategy
immersiveStrategy
}

This becomes the bridge between AI reasoning and rendering.


---

68. EXPERIENCE GENERATION SEED

Each experience generation should receive a unique seed.

The seed should influence:

- recipe combinations
- composition
- visual variations
- motion combinations
- interaction combinations

BUT must remain deterministic for reproducibility.

Store:

generationSeed
generationVersion
designDirection


---

69. NO RANDOM BROKEN WEBSITES

The uniqueness system must operate inside validated design constraints.

Do not permit:

- unreadable text
- inaccessible contrast
- hidden CTA
- broken navigation
- excessive motion
- unusable mobile layouts
- impossible interactions
- gigantic assets

Creative freedom must exist inside engineering guardrails.


---

70. JATA EXPERIENCE DESIGN SYSTEM

Build a reusable design system containing:

Typography
Spacing
Grid
Buttons
Forms
Cards
Media
Navigation
Modals
Drawers
Product displays
Service displays
CTA systems
Commerce components
Motion presets
3D components

AI composes the system rather than inventing raw CSS every time.


---

71. BRUNO SIMON-INSPIRED PRINCIPLE

Use the underlying philosophy of interactive 3D experiences:

- world
- camera
- interaction
- movement
- spatial storytelling
- physics where useful
- audio where useful
- exploration

BUT:

DO NOT CLONE BRUNO SIMON.

JATA is a commercial business platform.

The experience should help users:

DISCOVER
UNDERSTAND
TRUST
INTERACT
ORDER
BOOK
PAY
CONTACT


---

72. "COMMERCIAL IMMERSION"

Every immersive interaction should answer:

«Does this help the customer understand, trust or buy?»

If no:

Do not build it.

Examples:

Good:

Rotate product
→ inspect
→ buy

Good:

Explore property
→ inspect room
→ request viewing

Good:

Explore menu
→ select food
→ order

Bad:

3D effect
→ no business purpose

Avoid decorative complexity.


---

73. JATA EXPERIENCE ENGINE MODULES

Create clean modules:

ExperienceSchema
ExperienceRenderer
ExperienceCapabilityDetector
ExperienceDiversityEngine
ExperienceAI
DesignDirectionEngine
MotionEngine
ImmersiveEngine
SceneGraph
RecipeEngine
ImageEngine
ImageProviderAdapter
AssetPipeline
CommerceBridge
AnalyticsBridge
AccessibilityEngine
PerformanceEngine

Keep boundaries clear.


---

74. RECOMMENDED DIRECTORY STRUCTURE

Adapt to the existing repository structure rather than blindly creating duplicate systems.

Conceptually:

src/
experience/
schema/
renderer/
recipes/
motion/
immersive/
scene/
capability/
diversity/
ai/
image/
assets/
commerce/
analytics/
accessibility/
performance/

Use existing project conventions if they differ.

Do not duplicate existing services.


---

75. NO ARCHITECTURAL BREAKAGE

Before modifying anything:

AUDIT:

- existing Prisma schema
- Website Studio routes
- existing image upload
- existing product model
- existing tenant authorization
- existing Paystack flow
- existing POS
- existing ASK JATA
- existing authentication
- existing publishing flow

Reuse existing infrastructure.


---

76. DATABASE MIGRATION SAFETY

Before migrations:

- inspect existing schema
- identify relationships
- identify production data
- create additive migration
- preserve old fields
- do not rename destructive fields without migration compatibility
- test migration against development/preview DB

Never casually reset the production database.


---

77. EXISTING PRODUCTS MUST KEEP WORKING

After implementation:

Existing:

- business pages
- products
- services
- orders
- POS
- subscriptions
- payments
- authentication
- analytics

must continue functioning.

The immersive engine is an enhancement layer.


---

78. FALLBACK GUARANTEE

Every published Website Studio site must have:

IMMERSIVE
↓ failure
MOTION
↓ failure
LITE

There must NEVER be a blank page because of:

- Three.js
- WebGL
- WebGPU
- GLB
- image generation
- animation
- browser incompatibility


---

79. TESTING REQUIREMENTS

Create automated tests for:

Schema

- valid experience
- invalid experience
- version compatibility

Tenant isolation

- product isolation
- asset isolation
- experience isolation
- image isolation
- AI retrieval isolation

Rendering

- Lite
- Motion
- Immersive
- fallback

Mobile

- small viewport
- touch
- image upload
- gallery
- CTA

AI

- generation
- regeneration
- invalid AI response
- fallback

Images

- JPEG
- PNG
- WebP
- large Android photo
- malformed file
- orientation
- compression

Commerce

- WhatsApp
- call
- directions
- order
- payment
- POS

Publishing

- unpaid cannot publish
- entitled can publish
- preview does not alter production
- rollback works


---

80. END-TO-END TEST

At minimum, prove:

Create business
↓
Upload Android photo
↓
AI processes image
↓
Generate experience
↓
Preview
↓
Switch Lite
↓
Switch Motion
↓
Switch Immersive where supported
↓
Open product
↓
ASK JATA
↓
Order
↓
Payment flow
↓
POS


---

81. PERFORMANCE TEST DEVICES

Test representative:

- low-end Android
- mid-range Android
- modern Android
- desktop Chrome

Do not assume developer hardware represents Kenyan customers.

Test:

- slow network
- average mobile network
- fast network
- low-memory conditions


---

82. REAL-WORLD KENYAN MOBILE REQUIREMENT

Prioritize:

Android Chrome
small screens
touch
mobile data
low-end hardware
intermittent connectivity
battery efficiency
fast first meaningful content

The website must still work if a user has:

- a modest Android phone
- limited data
- poor connection
- no powerful GPU


---

83. PUBLISHING PERFORMANCE CHECK

Before publishing, calculate:

asset weight
initial JS
image weight
3D weight
number of requests
experience mode
fallback availability

If the experience is excessively heavy:

OPTIMIZE

before publication.


---

84. AUTOMATIC EXPERIENCE OPTIMIZATION

JATA should eventually be able to say:

This experience is too heavy for the expected audience.

Optimizing...

Then automatically:

- reduce image resolution
- remove unnecessary animation
- defer assets
- replace heavy effects
- compress 3D
- switch hero
- reduce particle count


---

85. DESIGN QUALITY SCORE

Create an internal:

ExperienceQualityScore

Evaluate:

visual hierarchy
mobile usability
CTA visibility
performance
accessibility
content quality
commerce clarity
uniqueness
interaction quality
asset quality

Do not publish an experience below an acceptable threshold unless the owner explicitly chooses to override.


---

86. IMAGE QUALITY SCORE

Create:

ImageQualityScore

Evaluate:

- resolution
- sharpness
- lighting
- composition
- subject integrity
- crop
- background
- brand consistency

Use it to recommend improvements.


---

87. AI CREATIVE MEMORY

For each business, preserve:

brand direction
accepted images
rejected images
preferred styles
approved colors
preferred typography
experience history

This allows regeneration without completely losing the owner's creative identity.

Do not use cross-tenant private data.


---

88. BRAND LOCK

Allow the owner to lock:

logo
brand colors
business name
product appearance
pricing
contact information

AI may design around these elements but must not casually modify them.


---

89. CUSTOMER CONTROL

AI generation should never mean loss of control.

Provide:

Regenerate
Undo
Redo
Change style
Change image
Change section
Edit text
Hide section
Move section
Set hero
Set CTA
Preview
Publish


---

90. THE "SURPRISE ME" FEATURE

Add:

✨ SURPRISE ME

JATA generates a deliberately unconventional but business-appropriate experience.

Examples:

- restaurant → cinematic food story
- fashion → interactive editorial
- property → spatial exploration
- salon → transformation journey
- tourism → interactive expedition

Still subject to:

- accessibility
- performance
- commerce
- mobile usability


---

91. THE "MAKE IT IMMERSIVE" FEATURE

For eligible devices:

MAKE IT IMMERSIVE

JATA automatically determines:

- whether 3D adds value
- which asset should become interactive
- camera behavior
- environment
- lighting
- interaction
- fallback

Do not automatically add 3D when it provides no value.


---

92. THE "MAKE IT SELL" FEATURE

Add AI optimization:

MAKE IT SELL

The AI evaluates:

- CTA placement
- product prominence
- price visibility
- offer visibility
- order path
- WhatsApp path
- booking path
- payment friction

Then optimizes the experience.


---

93. THE "MAKE IT FAST" FEATURE

Add:

MAKE IT FAST

The engine automatically optimizes:

- images
- JavaScript
- animation
- 3D
- lazy loading
- asset priorities

without changing the business content.


---

94. THE JATA CREATIVE LOOP

The long-term workflow becomes:

CREATE
↓
GENERATE
↓
PREVIEW
↓
INTERACT
↓
ANALYZE
↓
OPTIMIZE
↓
REGENERATE
↓
PUBLISH
↓
LEARN FROM REAL USAGE

This turns Website Studio into an evolving experience engine rather than a static builder.


---

95. ANALYTICS-DRIVEN AI

Eventually use anonymous aggregate experience performance to determine:

- which layouts convert
- which CTAs perform
- which interactions are ignored
- which assets load slowly
- which experience modes fail
- which templates retain visitors

Then improve future generation.

Do NOT expose one tenant's private analytics/data to another tenant.


---

96. WHAT MUST REMAIN LIGHTWEIGHT

Do NOT introduce:

- VPS requirement
- Kubernetes
- microservice explosion
- Redis requirement unless truly necessary
- dedicated rendering servers
- GPU servers for normal operation
- self-hosted giant AI models
- giant 3D worlds
- arbitrary AI-generated code
- mandatory WebGPU
- mandatory WebGL
- massive client-side bundles

The architecture must remain compatible with:

Vercel
+
Next.js
+
Neon
+
Prisma
+
Object/CDN storage


---

97. WHAT SHOULD LIVE WHERE

Vercel

- Next.js
- SSR
- API routes
- server actions
- authentication
- Website Studio
- Experience Engine
- AI orchestration
- commerce orchestration

Neon

- business data
- products
- services
- experiences
- configurations
- permissions
- metadata
- analytics summaries

Object/CDN storage

- photos
- generated images
- videos
- GLB
- textures
- audio

External AI providers

- image generation
- image enhancement
- AI reasoning where appropriate

Paystack

- JATA subscription/payment functionality already supported by the existing architecture

Do not move existing infrastructure unnecessarily.


---

98. IMPLEMENTATION PHASES

PHASE 1 — FOUNDATION

Build:

ExperienceSchema
ExperienceRenderer
ExperienceVersion
CapabilityDetector
Lite renderer

No major 3D yet.


---

PHASE 2 — MOTION

Build:

MotionEngine
GSAP integration
motion recipes
scroll storytelling
micro-interactions

Make Motion the default premium experience.


---

PHASE 3 — AI ART DIRECTOR

Build:

ExperienceAI
DesignDirection
TemplateDiversity
ExperienceRecipes

This is the beginning of automatic custom website generation.


---

PHASE 4 — JATA IMAGE STUDIO

Build:

ImageEngine
ImageProvider abstraction
Enhancement
Generation
Background generation
Variations
Asset pipeline

Fix mobile upload completely.


---

PHASE 5 — IMMERSIVE ENGINE

Build:

Three.js
GLB
WebGL
WebGPU capability path
Scene Graph
Product interactions


---

PHASE 6 — COMMERCE IMMERSION

Connect:

experience
↓
product/service
↓
ASK JATA
↓
order/booking
↓
M-Pesa
↓
POS


---

PHASE 7 — ADAPTIVE EXPERIENCE

Build:

performance analytics
device learning
automatic mode selection
experience optimization


---

99. DO NOT ATTEMPT EVERYTHING IN ONE UNSAFE CHANGE

Implement incrementally.

After every phase:

lint
typecheck
unit tests
integration tests
build
database migration validation
mobile validation

Then commit.

Then push to GitHub.

Do NOT leave changes only in the local working tree.


---

100. GIT REQUIREMENT

When implementation is complete:

git status
git diff
git log

Verify there are no accidental files.

Commit all intended changes.

Push to:

POWERBot-1/Jata-Aftercall

Do not push unrelated changes.

Report:

commit SHA
files changed
migrations
tests
build result
deployment status
known limitations


---

101. DO NOT CLAIM SUCCESS WITHOUT TESTING

Do not report:

DONE

simply because code compiles.

Verify:

- Website Studio
- image upload
- image generation
- AI experience generation
- preview
- mobile
- Lite
- Motion
- Immersive
- tenant isolation
- commerce
- ASK JATA
- publishing
- entitlement
- performance
- fallback


---

102. ACCEPTANCE CRITERIA

The implementation is considered successful only when:

A.

Existing JATA AFTERCALL functionality remains operational.

B.

Website Studio can generate a structured Business Experience.

C.

AI can generate a design direction.

D.

AI can select an appropriate experience composition.

E.

Two businesses can receive materially different experiences.

F.

A user can regenerate a different experience.

G.

The website works in Lite mode.

H.

The website works in Motion mode.

I.

Immersive mode works where supported.

J.

Immersive failure falls back safely.

K.

Android phone photos upload successfully.

L.

Image enhancement/generation works through the provider abstraction.

M.

Generated images can be assigned to website roles.

N.

Products remain connected to real tenant data.

O.

ASK JATA can answer using tenant-scoped business information.

P.

Interactive elements can invoke WhatsApp/Call/Directions/Order/Booking.

Q.

Existing payment architecture remains authoritative.

R.

POS integration remains intact.

S.

Unentitled customers cannot publish paid Website Studio experiences.

T.

No giant mandatory download is introduced for basic websites.

U.

Neon is not used as a binary media store.

V.

Tenant isolation remains absolute.

W.

The site remains usable on low-end Android.

X.

All changes are tested and pushed to GitHub.


---

103. THE FINAL PRODUCT EXPERIENCE

The final customer should experience this:

"I have a business."

↓

"Tell JATA what you do."

↓

Upload phone photos.

↓

JATA understands the business.

↓

JATA creates a visual identity.

↓

JATA improves or creates professional imagery.

↓

JATA designs a unique website.

↓

JATA adds motion.

↓

JATA determines whether immersive interaction adds value.

↓

JATA connects products/services.

↓

JATA connects WhatsApp.

↓

JATA connects M-Pesa/payment flows.

↓

JATA connects POS.

↓

JATA connects ASK JATA.

↓

Preview.

↓

Publish.

↓

LIVE.


---

104. THE JATA DIFFERENTIATOR

Do NOT position JATA merely as:

«"AI website builder."»

The intended product category is:

AI-GENERATED INTERACTIVE BUSINESS EXPERIENCE ENGINE

The fundamental proposition is:

«Give JATA your business, and JATA creates a unique digital experience through which customers can discover, understand, interact with, communicate with, and buy from that business.»

The combination to pursue is:

AI
+
IMAGE GENERATION
+
IMAGE ENHANCEMENT
+
UNIQUE DESIGN GENERATION
+
MOTION
+
3D
+
WEBGL
+
WEBGPU PATH
+
MOBILE OPTIMIZATION
+
WHATSAPP
+
M-PESA
+
POS
+
AI FRONT DESK
+
ANALYTICS

This combination—not 3D alone—is the strategic product.


---

105. "SIGMA-LEVEL" ENGINEERING PRINCIPLE

Build the system so that:

AI generates
↓
Schema validates
↓
Experience Engine renders
↓
Performance Engine optimizes
↓
Commerce Engine connects
↓
Analytics observes
↓
AI improves

This creates a closed-loop platform.

Do NOT build a collection of visual effects.

Build an ENGINE.


---

106. FINAL ARCHITECTURE

     ┌──────────────────────┐
                     │    JATA AFTERCALL    │
                     └──────────┬───────────┘
                                │
                                ▼
                     ┌──────────────────────┐
                     │   WEBSITE STUDIO     │
                     │  AI CREATIVE STUDIO  │
                     └──────────┬───────────┘
                                │
                ┌───────────────┼────────────────┐
                │               │                │
                ▼               ▼                ▼
          BUSINESS DATA    IMAGE ENGINE      AI ART DIRECTOR
                │               │                │
                └───────────────┼────────────────┘
                                ▼
                     EXPERIENCE SCHEMA
                                │
                                ▼
                 EXPERIENCE DIVERSITY ENGINE
                                │
                                ▼
                   EXPERIENCE RECIPE ENGINE
                                │
                                ▼
                  ┌─────────────┼─────────────┐
                  ▼             ▼             ▼
                LITE          MOTION       IMMERSIVE
              HTML/CSS       GSAP/CSS    Three.js
                                           WebGL
                                           WebGPU
                  │             │             │
                  └─────────────┼─────────────┘
                                ▼
                       BUSINESS EXPERIENCE
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
       PRODUCTS              SERVICES              CONTENT
          │                     │                     │
          └─────────────────────┼─────────────────────┘
                                ▼
                         COMMERCE BRIDGE
                                │
             ┌──────────────────┼──────────────────┐
             ▼                  ▼                  ▼
          WHATSAPP            M-PESA              POS
             │                  │                  │
             └──────────────────┼──────────────────┘
                                ▼
                         AI FRONT DESK
                                │
                                ▼
                            ASK JATA
                                │
                                ▼
                          REAL BUSINESS
                                │
                                ▼
                           ANALYTICS
                                │
                                ▼
                        EXPERIENCE AI
                                │
                                └──────→ IMPROVE


---

107. NON-NEGOTIABLE FINAL RULE

The goal is NOT:

«Make JATA Website Studio look like Bruno Simon.»

The goal is:

«Build an extensible engine capable of generating thousands of different, beautiful, interactive, commercially useful digital business experiences without manually designing each one.»

JATA should make the complexity invisible.

The business owner should experience:

"I uploaded my business. JATA built the world."

Engineering should experience:

"One schema. One renderer. Many validated experiences."

And the customer should experience:

"This website feels like it was made specifically for this business."


---

EXECUTION DIRECTIVE

Start by auditing the existing JATA AFTERCALL Website Studio implementation.

Do NOT rewrite the application blindly.

Identify:

1. existing Website Studio routes
2. existing Prisma models
3. existing image upload implementation
4. existing asset storage
5. existing product/service models
6. existing tenant authorization
7. existing publishing lifecycle
8. existing AI/ASK JATA implementation
9. existing payment/entitlement implementation
10. existing POS integration

Then implement the architecture incrementally.

Prioritize:

Phase 1 → Experience Schema + Renderer

Phase 2 → Motion Engine

Phase 3 → AI Art Director + Diversity Engine

Phase 4 → JATA Image Studio

Phase 5 → Three.js Immersive Engine

Phase 6 → Commerce + ASK JATA integration

Phase 7 → Performance/Adaptive Intelligence

Do not break existing functionality.

Do not remove working features merely to introduce the new engine.

Do not introduce a VPS requirement.

Do not introduce a mandatory heavy client bundle.

Do not store binary media in Neon.

Do not allow arbitrary AI-generated production code.

Do not allow tenant leakage.

Do not force 3D on low-end Android.

Do not make immersive effects more important than commerce.

Do not make every JATA website look the same.

Do not call the work complete without testing.

When all intended implementation is complete:

RUN THE FULL TEST SUITE → BUILD → VERIFY → COMMIT → PUSH TO GITHUB.

Report the final commit SHA and verification results.

CAUTION!!! GENER
```
