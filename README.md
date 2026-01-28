# Project Report: URL Shortener with Data Structure Visualization

## 1. Introduction
The **URL Shortener with Data Structure Visualization** is a full-stack web application designed to demonstrate the practical application of fundamental computer science data structures in a real-world scenario. While the primary function is to transform long, cumbersome URLs into short, shareable links, its unique selling point is the **live, interactive visualization** of the backend processes.

The project visualizes how a **HashMap** (LRU Cache) and a **Priority Queue** (Min-Heap) work in tandem to optimize link access and manage link expiration (TTL - Time To Live).

---

## 2. Problem Statement
Modern web applications handle millions of requests. For a URL shortener, two major challenges arise:
1.  **Lookup Speed**: Retrieving a long URL from a database for every click is slow and expensive.
2.  **Resource Management**: Links often need to expire after a certain period of time. Checking every link in the database periodically is inefficient.

This project solves these problems using:
-   **In-Memory Caching**: To reduce database load and provide $O(1)$ lookup time for popular links.
-   **Automated Cleanup**: To efficiently remove expired links without scanning the entire storage.

---

## 3. Core Features
-   **URL Shortening**: Generates a unique 6-character short code for any given long URL.
-   **Custom Expiry (TTL)**: Users can set a specific expiration time (minutes, hours, or days) for their links.
-   **Live HashMap Visualization**: Displays the "Least Recently Used" (LRU) cache status, showing hits, misses, and evictions in real-time.
-   **Live Priority Queue Visualization**: Visualizes a Min-Heap managing the expiration schedule of links.
-   **Real-time Complexity Analysis**: Each operation displays its Big-O complexity (e.g., $O(1)$, $O(\log n)$) to educate the user.
-   **Retro "Newspaper" Aesthetic**: A premium design inspired by classic typography and modern web standards.

---

## 4. Technology Stack
-   **Frontend**: HTML5, Vanilla CSS, JavaScript (ES6+), Server-Sent Events (SSE) for live updates.
-   **Backend**: Node.js, Express.js.
-   **Database**: MongoDB (via Mongoose) for persistent storage.
-   **Real-time Communication**: Server-Sent Events (SSE) provide a one-way bridge for the backend to push data structure updates to the frontend.

---

## 5. Technical Design: Data Structures

### 5.1 HashMap (LRU Cache)
-   **Purpose**: Stores the 5 most recently accessed links in memory.
-   **Implementation**: Utilizes the JavaScript `Map` object.
-   **Mechanism**: 
    -   When a link is accessed, the system checks the cache first (**Cache Hit** - $O(1)$).
    -   If not found, it fetches from the database (**Cache Miss**) and adds it to the cache.
    -   If the cache exceeds its capacity (5 items), it removes the least recently used item (**Eviction**).

### 5.2 Priority Queue (Min-Heap)
-   **Purpose**: Manages the Time-To-Live (TTL) of links.
-   **Implementation**: A custom-built Min-Heap class.
-   **Mechanism**:
    -   When a link with an expiry is created, it is inserted into the Min-Heap ($O(\log n)$).
    -   The heap is sorted by the `expiresAt` timestamp, ensuring the link expiring soonest is always at the root (**Peek** - $O(1)$).
    -   A background job periodically checks the root. if its time has passed, it is extracted ($O(\log n)$) and deleted.

---

## 6. Backend Implementation
The backend (`server.js`) serves as the "brain" of the application.
-   **MinHeap Class**: Implements `heapifyUp`, `heapifyDown`, `extractMin`, and `insert`.
-   **LRU Logic**: A custom wrapper around `Map` to handle expiration and eviction.
-   **SSE Endpoint**: The `/live-operations` endpoint keeps the frontend in sync by streaming every data structure mutation as it happens on the server.

---

## 7. Frontend Interface
The frontend (`index.html`) is designed with a premium, educational focus:
-   **Form Area**: Simple input for long URLs and custom TTL settings.
-   **HashMap Visualization**: Blocks represent cache slots; color-coded logs explain cache hits/misses.
-   **Priority Queue Visualization**: A visual list of the heap's current state, highlighting the next link set to expire.
-   **Complexity Tags**: Every logged operation is tagged with its computational complexity to bridge the gap between theory and practice.

---

## 8. Complexity Analysis
| Operation | Data Structure | Complexity | Reason |
| :--- | :--- | :--- | :--- |
| **URL Lookup (Cache)** | HashMap | $O(1)$ | Direct key-based access. |
| **Insert to Heap** | Min-Heap | $O(\log n)$ | Requires bubbling up to restore order. |
| **Remove Min (Expiry)** | Min-Heap | $O(\log n)$ | Requires bubbling down to restore order. |
| **Peek Next Expiry** | Min-Heap | $O(1)$ | Root element always contains the minimum. |

---

## 9. Conclusion
This project successfully marries functional utility with educational visualization. By implementing custom data structures and a real-time monitoring system, it provides a clear window into the "invisible" logic that powers high-performance web systems. It serves as an excellent demonstration of how algorithmic efficiency directly translates to better user experiences.
