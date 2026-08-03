# ---------- 1) Frontend build (Vite) ----------
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# .env.production → VITE_API_URL="" → eyni origin (relativ /api)
RUN npm run build

# ---------- 2) Backend publish (.NET) ----------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src
COPY backend/Backend.csproj ./backend/
RUN dotnet restore ./backend/Backend.csproj
COPY backend/ ./backend/
RUN dotnet publish ./backend/Backend.csproj -c Release -o /publish

# ---------- 3) Runtime ----------
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=backend /publish ./
# Build olunmuş frontend statik faylları
COPY --from=frontend /app/dist ./wwwroot
ENV ASPNETCORE_URLS=http://+:8080
ENV DB_DIR=/data
EXPOSE 8080
ENTRYPOINT ["dotnet", "Backend.dll"]
