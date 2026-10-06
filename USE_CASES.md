# What people can do with Scrapeline

This page lists **340 concrete use cases**, grouped by who's doing the work. Each one is a
*pattern*, not a single site. "Track prices on a product page" works on any shop, and
"pull a directory into a CSV" works on any directory. Multiply 340 patterns by the sites they
apply to and you get thousands of real jobs. The [combinations section](#multiply-it-patterns--sites)
at the end shows how.

Every entry has:
- **what you'd type to Claude** (plain English), and
- **the tools Claude would use**, so you can see it's something Scrapeline actually does today.

Also read **[What it can't do](#what-it-cant-do)** and **[Use it responsibly](#use-it-responsibly)**
at the bottom.

**Tool shorthand:** `tabs` = list_tabs · `info` = page_info · `outline` = page_outline ·
`text` = page_text · `query` = page_query · `extract` = page_extract · `scroll` = page_scroll ·
`open` = open_url · `crawl` = crawl_start · `urls` = extract_urls · `contacts` = find_contacts ·
`images` = find_images · `sitemap` = sitemap_explore · `shopify` = shopify_catalog ·
`recipe` = recipe_save / recipe_run

---

## 1. "Look at what I'm looking at" (everyday)

1. **What am I doing right now?** "Summarise my open tabs." · `tabs`
2. **Tab triage.** "Which of my 30 tabs are duplicates or things I finished reading?" · `tabs` → `info`
3. **Explain this page.** "Explain the page I'm on in simple words." · `text`
4. **TL;DR a long article.** "Give me the 5 key points of this article." · `text`
5. **Compare two open tabs.** "Compare the two laptops I have open side by side." · `tabs` → `text` ×2
6. **Find something on a page.** "Does this page mention a refund window?" · `text`
7. **Read the fine print.** "What are the cancellation terms on this page?" · `text`
8. **Get the table I'm looking at.** "Turn this table into CSV." · `extract` (saveAs csv)
9. **Get every link.** "List every download link on this page." · `outline` → `query`
10. **What's in this form?** "What fields does this signup form ask for?" · `outline`
11. **Summarise a thread.** "Summarise this forum thread and the main disagreement." · `text`
12. **Pull the comments.** "What are people saying in the comments?" · `scroll` → `text`
13. **Check a claim on screen.** "Is the stat quoted on this page sourced? Where from?" · `text` → `query`
14. **Translate a page's gist.** "What does this Japanese page say?" · `text`
15. **Glossary.** "List the jargon on this page and define each term." · `text`
16. **Draft a reply.** "Draft a reply to the email I have open." · `text`
17. **Turn a page into notes.** "Make revision notes from this page." · `text`
18. **Morning brief.** "Read my 5 news tabs and give me one combined brief." · `tabs` → `text` ×5
19. **What changed?** "Read this page, I'll ask again later to see what changed." · `text`
20. **Where did I see it?** "Which open tab talked about vector databases?" · `tabs` → `info`

## 2. Students and learners

21. **Course schedule to calendar list.** "List every deadline on my course dashboard." · `text` / `extract`
22. **Lecture page to notes.** "Turn this lecture page into structured notes." · `text`
23. **Syllabus to checklist.** "Make a week-by-week checklist from this syllabus." · `text`
24. **Compare courses.** "Compare these 4 Coursera courses by length, level and rating." · `urls`
25. **All courses in a catalogue.** "List every course in this catalogue with its duration." · `crawl`
26. **Reading list.** "Collect every paper linked from this course page." · `outline` → `query`
27. **Flashcards.** "Make 20 flashcards from this chapter." · `text`
28. **Quiz me.** "Quiz me on the page I'm reading." · `text`
29. **Scholarship hunt.** "Extract every scholarship on this listing: name, amount, deadline." · `crawl`
30. **Internship board.** "Crawl this internship board to CSV, location and stipend included." · `crawl` (detail)
31. **Exam timetable.** "Pull my exam timetable into a table." · `extract`
32. **Video page context.** "What's this video's title, channel and description?" · `info` → `text`
33. **Playlist outline.** "List every video in this playlist with its length." · `scroll` → `extract`
34. **Library search results.** "Export these library search results with ISBNs." · `extract`
35. **University comparison.** "Compare fees and deadlines across these 6 university pages." · `urls`
36. **Research a topic from tabs.** "Combine my 8 open tabs into one study guide." · `tabs` → `text`
37. **Citation list.** "Make citations for every tab I have open." · `tabs` → `info`
38. **Professor directory.** "List faculty in this department with their research areas." · `crawl` (detail)
39. **Past papers.** "List every past-paper PDF link on this page." · `query`
40. **Forum Q&A.** "Collect all unanswered questions from this course forum page." · `extract`

## 3. Shoppers

41. **Price check.** "What's the price and delivery date on this product?" · `text`
42. **Compare products.** "Compare these 5 product tabs in a table." · `tabs` → `urls`
43. **Search results to spreadsheet.** "Export these search results: name, price, rating." · `extract`
44. **All pages of results.** "Get all 20 pages of these results." · `crawl`
45. **Specs table.** "Pull the full spec table from this page." · `extract`
46. **Review summary.** "Summarise the reviews: pros, cons, common complaints." · `scroll` → `text`
47. **Cheapest variant.** "Which size/colour of this product is cheapest?" · `text`
48. **Coupon terms.** "What are the exclusions on this coupon page?" · `text`
49. **Watch a price.** "Save this as a recipe so I can check the price weekly." · `recipe`
50. **Grocery compare.** "Compare unit prices across these grocery listings." · `extract`
51. **Second-hand listings.** "Export these used-car listings with year, km and price." · `crawl`
52. **Shipping cost.** "Which of these shops has free shipping over what amount?" · `urls`
53. **Warranty check.** "What warranty does each of these products have?" · `urls`
54. **Out-of-stock check.** "Which of these products are out of stock?" · `urls`
55. **Gift ideas.** "Pull every item under ₹2,000 from this gift guide." · `extract`
56. **Bundle maths.** "Is the bundle actually cheaper than buying separately?" · `text`
57. **Seller check.** "What's this seller's rating and return policy?" · `text`
58. **Product images.** "Save all the product photos from this listing." · `images` (download)
59. **Deals page.** "List every deal on this page with its discount %." · `extract`
60. **Whole-shop catalogue.** "This shop runs on Shopify, get me its full catalogue." · `shopify`

## 4. Online sellers and e-commerce teams

61. **Competitor catalogue.** "Export a competitor's Shopify catalogue, every variant." · `shopify`
62. **Competitor pricing.** "Compare my prices with theirs for matching SKUs." · `shopify` ×2
63. **New arrivals.** "Which products did they add since last week?" · `recipe` (rerun + compare)
64. **Price changes.** "Which competitor prices changed since my last export?" · `recipe`
65. **Stock-outs.** "Which competitor variants are unavailable right now?" · `shopify`
66. **Category audit.** "Crawl my own category pages and flag missing prices." · `crawl`
67. **Product data QA.** "Check all my product pages for missing descriptions." · `sitemap` → `urls`
68. **JSON-LD check.** "Which of my product pages lack structured data?" · `urls`
69. **Marketplace listings.** "Export all listings in this marketplace category." · `crawl`
70. **Review mining.** "Summarise top complaints across this product's reviews." · `scroll` → `text`
71. **Supplier catalogue.** "Pull this supplier's product list with MOQs." · `crawl` (detail)
72. **Image audit.** "List my product images smaller than 800px." · `images`
73. **Tag and vendor mix.** "Which vendors and tags does this store use most?" · `shopify`
74. **Discount depth.** "What % of their catalogue is on sale, and how deep?" · `shopify`
75. **Bestseller page.** "Export their bestsellers page." · `extract`
76. **Bundle ideas.** "What do they bundle together?" · `shopify`
77. **Collection structure.** "Map their collections and product counts." · `sitemap`
78. **Dropship research.** "List products in this niche with price and rating." · `crawl`
79. **Launch check.** "Check every URL in my sitemap loads and has a price." · `sitemap` → `urls`
80. **Weekly competitor recipe.** "Save this as 'weekly competitor scan'." · `recipe`

## 5. Sales, business development and partnerships

> Contact data is personal data in many countries. Collect it only when you have a lawful reason,
> and follow the site's terms. See [Use it responsibly](#use-it-responsibly).

81. **Company contact page.** "Find the contact email and phone for this company." · `contacts` (discover)
82. **Lead list from a directory.** "Export this business directory: name, website, city." · `crawl`
83. **Enrich a list.** "For these 50 company sites, find their public contact pages." · `contacts` (urls)
84. **Social profiles.** "Find this company's LinkedIn, X and Instagram." · `contacts`
85. **Exhibitor list.** "Export every exhibitor from this trade-show page." · `crawl` (detail)
86. **Sponsor list.** "Who sponsors this conference?" · `images` / `outline`
87. **Partner pages.** "List every partner on this vendor's partner directory." · `crawl`
88. **Account research.** "Summarise this company from its About, Pricing and Careers pages." · `urls`
89. **Pricing tiers.** "Put their pricing tiers into a table." · `extract`
90. **Tech-stack hints.** "What do this company's job ads say about their stack?" · `crawl` → `text`
91. **Funding news.** "Summarise this company's press page." · `text`
92. **CRM view I'm looking at.** "Export the leads table I have open in my CRM." · `extract` (logged in)
93. **Local businesses.** "List the cafés on this local listings page with phone numbers." · `crawl`
94. **Chamber of commerce.** "Export members of this chamber directory." · `crawl`
95. **Meeting prep.** "Brief me on this person's public company page before my call." · `text`

## 6. Job seekers and recruiters

96. **Job board to CSV.** "Export all 10 pages of these job results." · `crawl`
97. **Full job details.** "Also open each job and grab salary and requirements." · `crawl` (detail)
98. **Match my CV.** "Which of these jobs fit my skills best?" · `crawl` → reasoning
99. **Salary ranges.** "What salary ranges do these listings show?" · `urls`
100. **Company careers page.** "List every open role at this company." · `extract`
101. **Remote-only filter.** "Which of these jobs are really remote?" · `urls`
102. **Application tracker.** "Make a tracker from the jobs I have open in tabs." · `tabs` → `urls`
103. **Skills demand.** "Which skills come up most across these 100 listings?" · `crawl` (detail)
104. **Recruiter view.** "Export the candidate list I have open in our ATS." · `extract` (logged in)
105. **Interview prep.** "Summarise this company's engineering blog." · `sitemap` → `urls`
106. **Glassdoor-style reviews.** "Summarise the reviews on this page." · `text`
107. **Visa sponsorship.** "Which of these listings mention visa sponsorship?" · `urls`
108. **Portfolio check.** "Pull project links from this candidate's portfolio." · `outline`
109. **Freelance gigs.** "Export these freelance gigs with budget and deadline." · `crawl`
110. **Deadline tracker.** "List closing dates for these government job notices." · `extract`

## 7. Real estate and renting

111. **Rental listings to CSV.** "Export these rentals: rent, area, bedrooms, locality." · `crawl`
112. **Listing details.** "Open each listing and add deposit and amenities." · `crawl` (detail)
113. **Price per sq ft.** "Compute price per sq ft for these listings." · `extract`
114. **Compare shortlisted flats.** "Compare the 6 flats I have open." · `tabs` → `urls`
115. **Project brochures.** "List every floor-plan image on this project page." · `images`
116. **Builder track record.** "List this builder's past projects from their site." · `crawl`
117. **Agent contacts.** "Get the agency's public contact details." · `contacts`
118. **Area research.** "Summarise these neighbourhood guide pages." · `urls`
119. **Price trend snapshot.** "Save this search as a recipe to rerun monthly." · `recipe`
120. **Auction listings.** "Export these property auction notices with dates." · `crawl`
121. **Co-living/PG compare.** "Compare these PG listings on price and food." · `urls`
122. **Commercial space.** "Export office spaces under 1,000 sq ft here." · `crawl`

## 8. Travel

123. **Flight results.** "Put these flight options in a table sorted by price." · `extract`
124. **Hotel compare.** "Compare these hotel tabs: price, rating, cancellation." · `tabs` → `urls`
125. **Hotel reviews.** "What do recent reviews say about noise and cleanliness?" · `scroll` → `text`
126. **Itinerary from blogs.** "Build a 3-day itinerary from these 4 travel blogs." · `urls`
127. **Visa requirements.** "Summarise the visa rules on this embassy page." · `text`
128. **Train/bus timetable.** "Pull this timetable into CSV." · `extract`
129. **Attractions list.** "List attractions on this page with hours and ticket price." · `extract`
130. **Restaurant shortlist.** "Export restaurants from this guide with cuisine and area." · `crawl`
131. **Booking confirmation.** "Summarise the booking I have open: dates, address, check-in." · `text`
132. **Packing list.** "Make a packing list from this destination guide." · `text`

## 9. Marketing, content and SEO

133. **Whole-site URL list.** "List every URL in this site's sitemap." · `sitemap`
134. **Title and meta audit.** "Check titles and descriptions for these 200 pages." · `sitemap` → `urls`
135. **Missing H1s.** "Which pages have no H1?" · `urls` (fields)
136. **Thin content.** "Which blog posts have under 300 words?" · `urls`
137. **Structured data audit.** "Which pages have JSON-LD, and what type?" · `urls`
138. **Competitor blog map.** "List every post on their blog with date." · `sitemap` / `crawl`
139. **Content gap.** "Which topics do they cover that we don't?" · `sitemap` ×2
140. **SERP snapshot.** "Export these search results: title, URL, snippet." · `extract`
141. **Backlink targets.** "List resource pages on this site that link out." · `outline` → `query`
142. **Image alt-text audit.** "Which images on these pages lack alt text?" · `images`
143. **Landing page teardown.** "Break down this landing page's headline, offer and CTAs." · `outline` → `text`
144. **Ad copy research.** "Collect the headlines from these competitor landing pages." · `urls`
145. **Influencer shortlist.** "Get the public social links from these creator sites." · `contacts`
146. **Newsletter archive.** "List every issue in this newsletter archive." · `crawl`
147. **Podcast guest list.** "List every guest from this podcast's episode page." · `crawl`
148. **Event listing SEO.** "Check every event page has date and location markup." · `urls`
149. **Pricing page history.** "Save their pricing page as a recipe to watch." · `recipe`
150. **Social proof.** "Collect every testimonial on this site." · `crawl` → `text`
151. **Brand mentions on a page.** "Where is our brand mentioned on this page?" · `text`
152. **Analytics view I'm on.** "Summarise the report table I have open in my dashboard." · `extract` (logged in)

## 10. Competitive intelligence and strategy

153. **Feature matrix.** "Build a feature comparison from these 5 pricing pages." · `urls`
154. **Changelog tracking.** "Summarise their changelog for the last 3 months." · `crawl`
155. **Release cadence.** "How often do they ship, judging by their release notes?" · `crawl`
156. **Hiring signals.** "Which teams is this competitor hiring for?" · `extract`
157. **Store footprint.** "Export their store locator results." · `extract` / `crawl`
158. **Menu and price watch.** "Export this restaurant chain's menu with prices." · `extract`
159. **Customer logos.** "Which customers appear on their site?" · `images` → `text`
160. **Case studies.** "Summarise every case study on their site." · `sitemap` → `urls`
161. **Docs coverage.** "How big are their docs, and what's covered?" · `sitemap`
162. **Integrations list.** "Export their integrations directory." · `crawl`
163. **Terms changes.** "Save their terms page as a recipe so we can diff it later." · `recipe`
164. **App marketplace.** "Export apps in this marketplace category with ratings." · `crawl`
165. **Positioning.** "Compare the homepage messaging of these 6 competitors." · `urls`
166. **Partner ecosystem.** "Map their partner and reseller list." · `crawl`
167. **Weekly digest.** "Rerun my competitor recipes and summarise what changed." · `recipe`

## 11. Journalism, research and fact-checking

168. **Source a quote.** "Find the exact passage this claim comes from on the page." · `text`
169. **Press releases.** "List every press release on this newsroom with date." · `crawl`
170. **Public records table.** "Export this public records table." · `extract` / `crawl`
171. **Election results page.** "Pull the constituency results into CSV." · `extract`
172. **Court listings.** "Export today's cause list from this court page." · `extract`
173. **Tender notices.** "Export all open tenders with value and closing date." · `crawl` (detail)
174. **Timeline building.** "Build a timeline from these 10 article tabs." · `tabs` → `urls`
175. **Compare coverage.** "How do these 4 outlets describe the same event?" · `urls`
176. **Image sourcing.** "List every image on this page with its source URL." · `images`
177. **Official statements.** "Collect all statements on this ministry page this month." · `crawl`
178. **Document index.** "List every PDF linked from this reports page." · `outline` → `query`
179. **Data-journalism starter.** "Crawl this listing into CSV for analysis." · `crawl`

## 12. Academic research and data science

180. **Build a dataset.** "Crawl this catalogue into a dataset, 2,000 rows." · `crawl` (saveAs csv)
181. **Paper list.** "Export these search results: title, authors, year, venue." · `extract`
182. **Conference programme.** "Export every accepted paper from this conference page." · `crawl`
183. **Abstracts.** "Open each paper and add the abstract." · `crawl` (detail)
184. **Lab directory.** "List labs and PIs at these universities." · `crawl`
185. **Survey sampling frame.** "Build a list of organisations from this directory." · `crawl`
186. **Web archive of a list.** "Save this listing as NDJSON for reproducibility." · `extract` (ndjson)
187. **Dataset portal.** "List every dataset on this open-data portal with its licence." · `crawl` (detail)
188. **Text corpus.** "Collect the full text of these 100 articles." · `urls` (textChars)
189. **Image dataset.** "Download all images from these pages for a small dataset." · `images` (download)
190. **Metadata harvest.** "Get JSON-LD metadata from these 300 URLs." · `urls`
191. **Replication.** "Save this crawl setup as a recipe so others can rerun it." · `recipe`
192. **Table cleaning.** "This table has merged cells, give me tidy CSV." · `extract`
193. **Grant opportunities.** "Export open grants with amount and deadline." · `crawl`
194. **Benchmark leaderboard.** "Export this leaderboard table." · `extract`

## 13. Money and personal finance (research only)

> Scrapeline gathers and organises information. It does not trade, transfer money, or give
> financial advice.

195. **Statement view.** "Put the transactions I have open in my bank portal into CSV." · `extract` (logged in)
196. **Spending categories.** "Categorise the transactions on this page." · `extract` → reasoning
197. **Subscription audit.** "Which recurring charges appear in this statement?" · `extract`
198. **Bill due dates.** "What's due and when, from the bills page I have open?" · `text`
199. **Fund factsheet.** "Summarise this fund's expense ratio and holdings table." · `extract`
200. **Company filings page.** "List every filing on this page with date and type." · `extract`
201. **Rates compare.** "Compare FD rates across these 6 bank pages." · `urls`
202. **Insurance compare.** "Compare these policies' cover and exclusions." · `urls`
203. **Loan offers.** "Compare interest, fees and tenure on these loan pages." · `urls`
204. **Tax rules.** "Summarise the deduction rules on this government page." · `text`
205. **Invoice list.** "Export the invoice list I have open in my billing portal." · `extract` (logged in)
206. **Crypto/stock page table.** "Export this market table I'm viewing (for my notes)." · `extract`

## 14. Developers and QA

207. **Docs to context.** "Read this API docs page and write a client for it." · `text`
208. **Endpoint list.** "List every endpoint on this API reference." · `outline` → `extract`
209. **Error on my page.** "Read the error message my local app is showing." · `text`
210. **Staging smoke test.** "Check every sitemap URL on staging loads with a title." · `sitemap` → `urls`
211. **Broken structure.** "Which of these pages are missing an H1 or meta description?" · `urls`
212. **Changelog reading.** "What changed in this library's last 3 releases?" · `text`
213. **Issue triage.** "Summarise the GitHub issues list I have open." · `extract`
214. **CI dashboard.** "Which jobs failed on the CI page I have open?" · `extract` (logged in)
215. **Admin panel data.** "Export the table in our admin panel." · `extract` (logged in)
216. **Selector debugging.** "What CSS selector matches the price on this page?" · `outline` → `query`
217. **Shadow DOM components.** "Read the text inside this web component." · `query` (shadow DOM)
218. **Iframe content.** "Read the embedded form inside the iframe." · `outline` → `info` (frameId)
219. **Accessibility pass.** "List images without alt text and unlabeled buttons." · `images` / `outline`
220. **Lazy-load check.** "Does the list keep loading as I scroll?" · `scroll` → `extract`
221. **Pagination check.** "Does our pagination work across all pages?" · `crawl`
222. **Stack Overflow answers.** "Summarise the accepted and top answers here." · `text`
223. **Package comparison.** "Compare these 3 npm package pages." · `urls`
224. **Status page.** "Summarise current incidents on this status page." · `text`
225. **Test data.** "Pull these rows to use as test fixtures." · `extract` (saveAs json)
226. **Migration inventory.** "Inventory every page of the old site before we migrate." · `sitemap` → `urls`

## 15. Creators, designers and media

227. **Moodboard.** "Download every image from these 5 inspiration pages." · `images` (download)
228. **Portfolio backup.** "Save all the images from my own portfolio site." · `images` (download)
229. **Colour and font notes.** "What fonts and headings does this page use?" · `outline` → `query`
230. **Video list.** "List every video on this channel page with views." · `scroll` → `extract`
231. **Episode guide.** "Export this show's episode list." · `extract`
232. **Book list.** "Export this best-seller list with author and rank." · `extract`
233. **Music charts.** "Export this chart table." · `extract`
234. **Stock-photo search.** "List these search results with licence type." · `extract`
235. **Caption ideas.** "Write captions based on this product page." · `text`
236. **Repurpose a post.** "Turn this blog post into a thread outline." · `text`
237. **Credits.** "List everyone credited on this page." · `text`
238. **Quote collection.** "Pull every pull-quote from this interview." · `text`

## 16. Work inside logged-in tools (your own accounts)

These work because Scrapeline reads the tab you're already signed into. It never signs in for
you, and it only reads pages. It never clicks or edits anything in these tools.

239. **Calendar view.** "What's on my calendar this week?" · `text`
240. **Two calendars.** "Find clashes between my two calendar tabs." · `tabs` → `text` ×2
241. **Inbox view.** "Summarise the emails in the inbox view I have open." · `text`
242. **Project board.** "List the tasks in the 'Blocked' column." · `text` / `extract`
243. **Ticket queue.** "Export the support tickets I have open." · `extract`
244. **Spreadsheet-like web tables.** "Export this report table from our internal tool." · `extract`
245. **HR portal.** "What's my leave balance, from the page I have open?" · `text`
246. **Learning portal.** "Which modules on my LMS dashboard are incomplete?" · `text`
247. **Wiki page.** "Summarise this internal wiki page." · `text`
248. **Wiki space inventory.** "List every page linked from this wiki index." · `outline` → `query`
249. **Order history.** "Export my order history from this account page." · `crawl` (inPlace)
250. **Chat export.** "Summarise the chat thread I have open." · `scroll` → `text`
251. **Invoices portal.** "List unpaid invoices on this page." · `extract`
252. **Analytics tab.** "What are the top 10 pages in this analytics table?" · `extract`
253. **Meeting notes.** "Turn the notes page I have open into action items." · `text`

## 17. Public sector, NGOs and civic work

254. **Scheme directory.** "Export every welfare scheme listed with eligibility." · `crawl` (detail)
255. **NGO directory.** "List NGOs in this directory with city and focus area." · `crawl`
256. **Donor research.** "Summarise these foundations' focus areas." · `urls`
257. **Public notices.** "Export this month's public notices." · `crawl`
258. **Budget table.** "Pull this budget allocation table into CSV." · `extract`
259. **Representatives list.** "List elected representatives with constituency." · `crawl`
260. **Hospital directory.** "Export hospitals in this directory with contact numbers." · `crawl`
261. **School directory.** "Export schools in this district listing." · `crawl`
262. **Volunteer opportunities.** "List volunteer openings with dates and location." · `crawl`
263. **RTI/FOI responses.** "Index the responses on this disclosure page." · `extract`

## 18. Personal life admin

264. **Recipe to shopping list.** "Make a shopping list from this recipe page." · `text`
265. **Meal plan.** "Build a week of meals from these 7 recipe tabs." · `tabs` → `urls`
266. **Appointment details.** "What time and address is the appointment on this page?" · `text`
267. **Form checklist.** "What documents does this application page ask for?" · `text`
268. **Warranty info.** "Save the warranty terms from this product page." · `text`
269. **Utility bill.** "Summarise the charges on this bill page." · `text`
270. **Wedding/event vendors.** "Compare these vendor pages on price and packages." · `urls`
271. **Gym timetable.** "Pull this class timetable into a table." · `extract`
272. **School circulars.** "List dates and actions from these school notices." · `text`
273. **Pet adoption.** "Export adoptable pets from this shelter page." · `crawl`
274. **Car service.** "Compare service packages on these pages." · `urls`
275. **Moving checklist.** "Make a checklist from this moving guide." · `text`
276. **Doctor directory.** "List doctors on this page with speciality and timings." · `extract`
277. **Recipe collection.** "Save these recipes' ingredients and steps as JSON." · `urls` (saveAs json)
278. **Reading list.** "Turn my open article tabs into a reading list with summaries." · `tabs` → `urls`

## 19. Teachers and trainers

279. **Lesson from a page.** "Make a lesson plan from this article." · `text`
280. **Worksheet.** "Make 10 questions from this page for class 8." · `text`
281. **Resource hunt.** "List all worksheets linked from this resource page." · `outline` → `query`
282. **Curriculum map.** "Extract the curriculum table from this board's page." · `extract`
283. **Reading level.** "Simplify this page for younger students." · `text`
284. **Quiz bank.** "Collect questions from these 5 practice pages." · `urls`
285. **Course catalogue.** "List all courses on this training provider's site." · `crawl`
286. **Student portal view.** "Summarise submissions on the LMS page I have open." · `extract`
287. **Field-trip planning.** "Compare these museum pages on timing and group rates." · `urls`
288. **Slides outline.** "Outline slides from this long article." · `text`

## 20. Health and science reading

> Summaries of what pages say, not medical advice. Check with a professional.

289. **Paper summary.** "Summarise the method and results of this paper page." · `text`
290. **Trial registry.** "Export these clinical-trial search results." · `extract`
291. **Drug label.** "Summarise the warnings section on this label page." · `text`
292. **Guideline compare.** "How do these two guideline pages differ?" · `urls`
293. **Nutrition table.** "Pull this nutrition table into CSV." · `extract`
294. **Hospital services.** "Which of these hospitals offer this service?" · `urls`
295. **Research roundup.** "Summarise the 6 study tabs I have open." · `tabs` → `urls`
296. **Science glossary.** "Define every technical term on this page." · `text`

## 21. Events and communities

297. **Event listing.** "Export upcoming events: name, date, venue, price." · `crawl`
298. **Speaker list.** "List every speaker with their talk title." · `crawl` (detail)
299. **Hackathon list.** "Export open hackathons with deadlines and prizes." · `crawl`
300. **Meetup groups.** "List groups in this city on this topic." · `extract`
301. **Agenda to calendar list.** "Turn this conference agenda into a timed list." · `extract`
302. **Community forum.** "What are the top threads this week?" · `extract`
303. **Club directory.** "Export this sports club directory." · `crawl`
304. **Ticket compare.** "Compare ticket tiers on this event page." · `extract`

## 22. Small and local businesses

305. **Supplier compare.** "Compare these 5 supplier price lists." · `urls`
306. **Local competitors.** "List similar shops on this local directory with ratings." · `crawl`
307. **Own listings check.** "Is our business info consistent across these 8 directory pages?" · `urls`
308. **Review replies.** "Draft replies to the reviews on this page." · `text`
309. **Menu pricing.** "Compare our menu prices with these 4 restaurants." · `urls`
310. **Wholesale catalogue.** "Export this wholesale catalogue with pack sizes." · `crawl`
311. **Tender search.** "Export tenders matching our category." · `crawl`
312. **Website health.** "Check every page of our site has contact info." · `sitemap` → `contacts`
313. **Stock images.** "Download our product photos from our old site." · `images` (download)
314. **Marketplace fees.** "Summarise the fee tables on these marketplace pages." · `urls`

## 23. Policy, legal and compliance reading

> Summaries of what a page says, not legal advice.

315. **Terms summary.** "Summarise this site's terms of service in plain language." · `text`
316. **Privacy policy compare.** "Compare what these 3 apps say they collect." · `urls`
317. **Policy inventory.** "List every policy page linked in this footer." · `outline` → `query`
318. **Regulation index.** "Export this list of regulations with dates." · `extract`
319. **Cookie list.** "What cookies does this site's cookie page list?" · `extract`
320. **Robots rules.** "Is crawling this path allowed by robots.txt?" · `crawl` (respectRobots)
321. **Licence check.** "What licence is this dataset or image under?" · `text`
322. **Compliance evidence.** "Save a JSON snapshot of this policy page's text." · `urls` (saveAs json)

## 24. Saved, repeatable jobs (recipes)

323. **Weekly price watch.** "Save this product-list extract as 'price watch'." · `recipe_save`
324. **Monthly catalogue export.** "Rerun 'competitor catalogue' and save as CSV." · `recipe_run`
325. **Daily job board.** "Rerun 'jobs' with maxPages 5." · `recipe_run` (override)
326. **Share a setup.** "Save this crawl so my teammate can run it." · `recipe_save` (JSON file)
327. **Swap the target.** "Run 'shop scan' but for this other store URL." · `recipe_run` (override)
328. **Recipe library.** "What recipes have I saved?" · `recipe_list`
329. **Clean up.** "Delete the old 'test' recipe." · `recipe_delete`
330. **Before/after compare.** "Rerun this recipe and compare with last week's file." · `recipe_run` → reasoning
331. **Standard audit.** "Save 'SEO audit' and run it on each new site I give you." · `recipe`
332. **Scheduled runs.** Pair a recipe with your MCP client's scheduler. Only works while your
     browser is open, because Scrapeline has no cloud. · `recipe_run`

## 25. Multi-step jobs where Claude chains tools

333. **Sitemap → bulk extract.** "Map this site, then extract every product page." · `sitemap` → `urls`
334. **Search → crawl → details.** "Crawl these results and open each for full specs." · `crawl` (detail)
335. **Tabs → compare → export.** "Compare my open product tabs and save a CSV." · `tabs` → `urls`
336. **Discover → contacts.** "Find this site's contact page and get the details." · `contacts` (discoverFrom)
337. **Outline → selector → extract.** "Work out the right selectors, then extract everything." · `outline` → `query` → `extract`
338. **Extract → images.** "Get the list, then download every item's photo." · `crawl` → `images`
339. **Crawl → analyse.** "Crawl 500 listings, then tell me the price distribution." · `crawl` (saveAs) → analysis
340. **Research → report.** "Read these 10 sources and write a cited report." · `tabs` → `urls` → writing

---

## Multiply it: patterns × sites

Almost every use case above is one of **12 core patterns**. Each pattern runs on any site of the
right shape, so you can combine the two lists below.

| # | Core pattern | Tools |
|---|---|---|
| A | Read and explain a page | `text` |
| B | Compare several pages | `tabs` / `urls` |
| C | Table or list → CSV/JSON | `extract` |
| D | Every page of a listing | `crawl` |
| E | Listing plus each item's detail page | `crawl` + `detail` |
| F | Many known URLs → one row each | `urls` |
| G | Whole-site URL map | `sitemap` |
| H | Contact and social details | `contacts` |
| I | Image list or download | `images` |
| J | Whole Shopify catalogue | `shopify` |
| K | Read your logged-in view | `text` / `extract` on your own tab |
| L | Save and rerun | `recipe` |

**Site types these patterns apply to (40):** online shops · marketplaces · Shopify stores ·
job boards · careers pages · rental and property portals · hotel and flight results ·
restaurant guides · business directories · trade-show exhibitor lists · conference agendas ·
event listings · news sites · press newsrooms · blogs · newsletters · forums · Q&A sites ·
review pages · course catalogues · LMS dashboards · university and faculty pages ·
paper search results · open-data portals · government notice boards · tender portals ·
court and public-record tables · NGO and scheme directories · hospital and doctor directories ·
product docs and API references · changelogs and release notes · status pages ·
issue trackers · CI dashboards · admin panels · CRMs and ATSs · calendars · webmail views ·
wikis · analytics dashboards.

12 patterns × 40 site types = **480 combinations**. Most combinations make sense for several
of the ~25 kinds of people in sections 1–25 (a student and a recruiter both crawl job boards,
but for different reasons). That's how 340 written-out cases grow into **thousands of real jobs**.
Each new site you use it on is another one.

---

## What it can't do

Being clear about limits is part of being useful:

- **No clicking, typing or form filling.** It reads pages. The only thing it clicks is a
  crawl's "Next page" control, and it refuses anything that looks like buy, delete, submit or
  sign out.
- **No signing in.** It uses sessions you're already signed into, and never touches passwords.
- **No CAPTCHA solving, fingerprint spoofing, proxy rotation or paywall bypass.**
- **Nothing runs while your browser or the MCP server is closed.** There's no cloud.
- **Video and audio aren't read.** A video page's title, description and comments work.
  Transcripts only work if the page already shows them as text.
- **Some content isn't in the page's HTML.** Canvas-drawn apps (some online spreadsheets and
  design tools), closed shadow roots, and the built-in PDF viewer can't be read.
- **Browser-internal pages and extension stores are refused** (`chrome://`, `edge://`, the Web
  Stores).
- **claude.ai in the browser can't connect to it.** Use Claude Code, Claude Desktop or another
  local MCP client. See the README.

## Use it responsibly

- **Follow each site's terms.** Some sites forbid automated collection. Scrapeline checks
  `robots.txt` and warns you, or refuses with `respectRobots: true`. The terms of service are
  still your responsibility.
- **Be polite.** Keep the default delays and page caps. Don't point crawls at small sites with
  huge `maxPages`.
- **Personal data is regulated.** Emails, phone numbers and profiles are personal data under laws
  like GDPR and India's DPDP Act. Collect them only when you have a lawful reason, keep only what
  you need, and never use them for spam.
- **Your logged-in data is yours, but others' data in it isn't.** Exporting your own orders or
  calendar is fine. Exporting a colleague list or customer records may need your organisation's
  permission.
- **Copyright still applies.** Downloading images or full articles for personal reference is
  different from republishing them.
- **Page text is untrusted.** Scrapeline labels everything it reads, so instructions hidden in a
  page are treated as data, not commands. Still review what Claude produces before acting on it.

