# Real-time clothing care label scanner with Gemini

[简体中文](README.md) | [English](README.en.md)

**Point your camera at a clothing label to find out how to wash it and whether it can go in the dryer.**

This project started with an everyday frustration: the laundry is done, but which clothes can go in the dryer, and which might shrink? The answers are on the care labels, but all those squares, circles, lines, and dots are hard to remember.

So I built a small tool to help. Open the website on your phone and point the camera at a label. There is no shutter button, no manual photo upload, and no symbol chart to look up. The app automatically selects a frame and asks Gemini to read the text and symbols, turning them into easy-to-understand care instructions.

It focuses on two questions:

- **Can I tumble dry it?** Whether tumble drying is prohibited or requires conditions such as low heat.
- **How should I wash it?** Whether washing is allowed, what temperature to use, and whether to machine wash or hand wash.

The idea is to keep things simple: no installation, no account, and support for both Chinese and English. You can try it for free or enter your own Gemini API key to keep using it.

Hopefully, it becomes a little tool you reach for while doing laundry—one less symbol chart to check, and one less favorite shirt accidentally shrunk. Recognition can still be wrong. When the image is blurry or the information is incomplete, the app can report uncertainty. If you are unsure, check the original label clearly before proceeding.

[Try it in your browser →](https://care-scan-chi.vercel.app/)
