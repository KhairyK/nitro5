#include <napi.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

#if !defined(_WIN32)
#include <unistd.h>
#include <sys/resource.h>
#endif

namespace nitro5 {

static std::mutex g_logMutex;
static std::string g_logFilePath;

static std::string NowString() {
  using namespace std::chrono;
  auto now = system_clock::now();
  std::time_t t = system_clock::to_time_t(now);

  std::tm tm{};
#if defined(_WIN32)
  localtime_s(&tm, &t);
#else
  localtime_r(&t, &tm);
#endif

  std::ostringstream oss;
  oss << std::put_time(&tm, "%Y-%m-%d %H:%M:%S");
  return oss.str();
}

static void AppendLog(const std::string& level, const std::string& message) {
  std::lock_guard<std::mutex> lock(g_logMutex);
  if (g_logFilePath.empty()) return;

  std::ofstream out(g_logFilePath, std::ios::app);
  if (!out.is_open()) return;

  out << "[" << NowString() << "]"
      << "[" << level << "] "
      << message << "\n";
}

static inline bool IsSpace(char c) {
  return std::isspace(static_cast<unsigned char>(c)) != 0;
}

static inline std::string_view TrimView(std::string_view input) {
  size_t start = 0;
  while (start < input.size() && IsSpace(input[start])) start++;

  size_t end = input.size();
  while (end > start && IsSpace(input[end - 1])) end--;

  return input.substr(start, end - start);
}

static inline std::string_view StripCR(std::string_view s) {
  if (!s.empty() && s.back() == '\r') {
    s.remove_suffix(1);
  }
  return s;
}

static std::string ToLowerAscii(std::string_view value) {
  std::string out;
  out.resize(value.size());
  for (size_t i = 0; i < value.size(); ++i) {
    out[i] = static_cast<char>(std::tolower(static_cast<unsigned char>(value[i])));
  }
  return out;
}

static bool IEqualsAscii(std::string_view a, std::string_view b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (std::tolower(static_cast<unsigned char>(a[i])) !=
        std::tolower(static_cast<unsigned char>(b[i]))) {
      return false;
    }
  }
  return true;
}

static bool IContainsTokenList(std::string_view csv, std::string_view token) {
  if (token.empty()) return true;

  size_t pos = 0;
  while (pos <= csv.size()) {
    size_t comma = csv.find(',', pos);
    std::string_view part = (comma == std::string_view::npos)
      ? csv.substr(pos)
      : csv.substr(pos, comma - pos);

    part = TrimView(part);
    if (IEqualsAscii(part, token)) return true;

    if (comma == std::string_view::npos) break;
    pos = comma + 1;
  }

  return false;
}

static int HexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
  if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
  return -1;
}

static std::string UrlDecode(std::string_view input) {
  std::string out;
  out.reserve(input.size());

  for (size_t i = 0; i < input.size(); ++i) {
    char c = input[i];
    if (c == '+') {
      out.push_back(' ');
    } else if (c == '%' && i + 2 < input.size()) {
      int hi = HexValue(input[i + 1]);
      int lo = HexValue(input[i + 2]);
      if (hi >= 0 && lo >= 0) {
        out.push_back(static_cast<char>((hi << 4) | lo));
        i += 2;
      } else {
        out.push_back(c);
      }
    } else {
      out.push_back(c);
    }
  }

  return out;
}

static Napi::Value JsonParse(Napi::Env env, const std::string& body) {
  Napi::Object global = env.Global();
  Napi::Object JSON = global.Get("JSON").As<Napi::Object>();
  Napi::Function parse = JSON.Get("parse").As<Napi::Function>();
  return parse.Call(JSON, { Napi::String::New(env, body) });
}

static std::string JsonStringify(Napi::Env env, const Napi::Value& v) {
  Napi::Object global = env.Global();
  Napi::Object JSON = global.Get("JSON").As<Napi::Object>();
  Napi::Function stringify = JSON.Get("stringify").As<Napi::Function>();
  Napi::Value json = stringify.Call(JSON, { v });
  return json.ToString().Utf8Value();
}

static std::string GetHeaderSingle(const Napi::Object& headers, const std::string& key) {
  if (!headers.Has(key)) return "";

  Napi::Value v = headers.Get(key);
  if (v.IsString()) return v.As<Napi::String>().Utf8Value();

  if (v.IsArray()) {
    Napi::Array arr = v.As<Napi::Array>();
    if (arr.Length() == 0) return "";
    Napi::Value first = arr.Get((uint32_t)0);
    if (first.IsString()) return first.As<Napi::String>().Utf8Value();
    return first.ToString().Utf8Value();
  }

  return v.ToString().Utf8Value();
}

static bool HeaderContains(const Napi::Object& headers, const std::string& key, const std::string& token) {
  std::string value = ToLowerAscii(GetHeaderSingle(headers, key));
  std::string needle = ToLowerAscii(token);
  return IContainsTokenList(value, needle);
}

static void AddHeaderValue(Napi::Env env, Napi::Object headers, std::string_view key, std::string_view value) {
  std::string k(key);
  std::string v(value);

  if (!headers.Has(k)) {
    headers.Set(k, v);
    return;
  }

  Napi::Value existing = headers.Get(k);
  if (existing.IsArray()) {
    Napi::Array arr = existing.As<Napi::Array>();
    arr.Set(arr.Length(), Napi::String::New(env, v));
    headers.Set(k, arr);
    return;
  }

  Napi::Array arr = Napi::Array::New(env);
  arr.Set((uint32_t)0, existing);
  arr.Set((uint32_t)1, Napi::String::New(env, v));
  headers.Set(k, arr);
}

static Napi::Object ParseUrlEncodedToObject(Napi::Env env, const std::string& body) {
  Napi::Object obj = Napi::Object::New(env);

  size_t start = 0;
  while (start <= body.size()) {
    size_t amp = body.find('&', start);
    std::string pair = body.substr(start, amp == std::string::npos ? std::string::npos : amp - start);

    if (!pair.empty()) {
      size_t eq = pair.find('=');
      std::string k = UrlDecode(eq == std::string::npos ? pair : pair.substr(0, eq));
      std::string v = UrlDecode(eq == std::string::npos ? "" : pair.substr(eq + 1));
      obj.Set(k, v);
    }

    if (amp == std::string::npos) break;
    start = amp + 1;
  }

  return obj;
}

static std::string NormalizeContentType(const std::string& ct) {
  std::string lower = ToLowerAscii(ct);
  size_t semi = lower.find(';');
  if (semi != std::string::npos) lower = lower.substr(0, semi);
  return std::string(TrimView(lower));
}

static std::string DecodeChunkedBody(std::string_view raw) {
  std::string out;
  out.reserve(raw.size());

  size_t pos = 0;
  while (pos < raw.size()) {
    size_t lineEnd = raw.find("\r\n", pos);
    if (lineEnd == std::string_view::npos) {
      throw std::runtime_error("Invalid chunked body: missing chunk size line ending");
    }

    std::string_view sizeLine = raw.substr(pos, lineEnd - pos);
    sizeLine = TrimView(sizeLine);

    size_t semi = sizeLine.find(';');
    if (semi != std::string_view::npos) {
      sizeLine = sizeLine.substr(0, semi);
      sizeLine = TrimView(sizeLine);
    }

    if (sizeLine.empty()) {
      throw std::runtime_error("Invalid chunked body: empty chunk size");
    }

    size_t chunkSize = 0;
    try {
      chunkSize = static_cast<size_t>(std::stoull(std::string(sizeLine), nullptr, 16));
    } catch (...) {
      throw std::runtime_error("Invalid chunked body: bad chunk size");
    }

    pos = lineEnd + 2;

    if (chunkSize == 0) {
      break;
    }

    if (pos + chunkSize > raw.size()) {
      throw std::runtime_error("Invalid chunked body: chunk overflows buffer");
    }

    out.append(raw.data() + pos, chunkSize);
    pos += chunkSize;

    if (pos + 2 > raw.size() || raw.substr(pos, 2) != "\r\n") {
      throw std::runtime_error("Invalid chunked body: missing chunk terminator");
    }
    pos += 2;
  }

  return out;
}

static bool ShouldKeepAlive(const std::string& httpVersion, const Napi::Object& headers) {
  std::string conn = ToLowerAscii(GetHeaderSingle(headers, "connection"));

  if (httpVersion == "HTTP/1.1") {
    return conn != "close";
  }

  if (httpVersion == "HTTP/1.0") {
    return conn == "keep-alive";
  }

  return conn == "keep-alive";
}

static Napi::Value ParseBodyByContentType(Napi::Env env, const std::string& contentType, const std::string& body) {
  std::string ct = NormalizeContentType(contentType);

  if (ct == "application/json" || ct.find("+json") != std::string::npos) {
    try {
      return JsonParse(env, body);
    } catch (...) {
      return Napi::String::New(env, body);
    }
  }

  if (ct == "application/x-www-form-urlencoded") {
    return ParseUrlEncodedToObject(env, body);
  }

  return Napi::String::New(env, body);
}

static std::string StatusText(int status) {
  switch (status) {
    case 100: return "Continue";
    case 101: return "Switching Protocols";
    case 200: return "OK";
    case 201: return "Created";
    case 202: return "Accepted";
    case 204: return "No Content";
    case 206: return "Partial Content";
    case 301: return "Moved Permanently";
    case 302: return "Found";
    case 304: return "Not Modified";
    case 400: return "Bad Request";
    case 401: return "Unauthorized";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 405: return "Method Not Allowed";
    case 408: return "Request Timeout";
    case 413: return "Payload Too Large";
    case 414: return "URI Too Long";
    case 415: return "Unsupported Media Type";
    case 426: return "Upgrade Required";
    case 500: return "Internal Server Error";
    case 501: return "Not Implemented";
    case 502: return "Bad Gateway";
    case 503: return "Service Unavailable";
    default: return "OK";
  }
}

static std::string ValueToStringLike(const Napi::Value& v, Napi::Env env, bool& jsonLike) {
  jsonLike = false;

  if (v.IsUndefined() || v.IsNull()) {
    return "";
  }

  if (v.IsString()) return v.As<Napi::String>().Utf8Value();
  if (v.IsNumber()) return v.ToNumber().ToString().Utf8Value();
  if (v.IsBoolean()) return v.ToBoolean().Value() ? "true" : "false";

  if (v.IsBuffer()) {
    auto buf = v.As<Napi::Buffer<uint8_t>>();
    return std::string(reinterpret_cast<char*>(buf.Data()), buf.Length());
  }

  jsonLike = true;
  return JsonStringify(env, v);
}

Napi::Value Hello(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::String::New(env, "Nitro5 native core loaded");
}

Napi::Value SetLogFile(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "setLogFile expects a string path").ThrowAsJavaScriptException();
    return env.Null();
  }

  g_logFilePath = info[0].As<Napi::String>().Utf8Value();
  return Napi::Boolean::New(env, true);
}

Napi::Value Log(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1) {
    Napi::TypeError::New(env, "log expects at least one argument").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string level = "INFO";
  std::string message;

  if (info.Length() >= 2 && info[0].IsString() && info[1].IsString()) {
    level = info[0].As<Napi::String>().Utf8Value();
    message = info[1].As<Napi::String>().Utf8Value();
  } else {
    message = info[0].ToString().Utf8Value();
  }

  AppendLog(level, message);
  return env.Undefined();
}

Napi::Value GetMetrics(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

#if !defined(_WIN32)
  struct rusage usage;
  getrusage(RUSAGE_SELF, &usage);

  long memoryKB = usage.ru_maxrss;
  double userCPU = usage.ru_utime.tv_sec + usage.ru_utime.tv_usec / 1e6;
  double sysCPU  = usage.ru_stime.tv_sec + usage.ru_stime.tv_usec / 1e6;
#else
  long memoryKB = 0;
  double userCPU = 0.0;
  double sysCPU = 0.0;
#endif

  Napi::Object obj = Napi::Object::New(env);
  obj.Set("memoryKB", memoryKB);
  obj.Set("cpuUser", userCPU);
  obj.Set("cpuSystem", sysCPU);
  return obj;
}

Napi::Value ParseHttpRequest(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "parseHttpRequest expects a raw HTTP request string").ThrowAsJavaScriptException();
    return env.Null();
  }

  size_t maxSize = 1024 * 1024;
  if (info.Length() >= 2 && info[1].IsNumber()) {
    double n = info[1].As<Napi::Number>().DoubleValue();
    if (n > 0) maxSize = static_cast<size_t>(n);
  }

  std::string raw = info[0].As<Napi::String>().Utf8Value();
  if (raw.size() > maxSize) {
    Napi::Error::New(env, "Request too large").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string_view rawView(raw);

  size_t headerEnd = rawView.find("\r\n\r\n");
  if (headerEnd == std::string_view::npos) {
    Napi::Error::New(env, "Invalid HTTP request: missing header terminator").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string_view head = rawView.substr(0, headerEnd);
  std::string_view rawBodyView = rawView.substr(headerEnd + 4);

  // Request line
  size_t lineEnd = head.find("\r\n");
  std::string_view requestLine = (lineEnd == std::string_view::npos)
    ? head
    : head.substr(0, lineEnd);

  requestLine = StripCR(requestLine);
  requestLine = TrimView(requestLine);

  size_t sp1 = requestLine.find(' ');
  if (sp1 == std::string_view::npos) {
    Napi::Error::New(env, "Invalid HTTP request line").ThrowAsJavaScriptException();
    return env.Null();
  }

  size_t sp2 = requestLine.find(' ', sp1 + 1);
  if (sp2 == std::string_view::npos) {
    Napi::Error::New(env, "Invalid HTTP request line").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string method = std::string(TrimView(requestLine.substr(0, sp1)));
  std::string fullPath = std::string(TrimView(requestLine.substr(sp1 + 1, sp2 - sp1 - 1)));
  std::string httpVersion = std::string(TrimView(requestLine.substr(sp2 + 1)));

  if (method.empty() || fullPath.empty() || httpVersion.empty()) {
    Napi::Error::New(env, "Invalid HTTP request line").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string pathname = fullPath;
  std::string query = "";

  size_t queryIndex = fullPath.find('?');
  if (queryIndex != std::string::npos) {
    pathname = fullPath.substr(0, queryIndex);
    query = fullPath.substr(queryIndex + 1);
  }

  // Headers
  Napi::Object headers = Napi::Object::New(env);

  size_t cursor = lineEnd == std::string_view::npos ? head.size() : lineEnd + 2;
  while (cursor < head.size()) {
    size_t next = head.find("\r\n", cursor);
    std::string_view line = (next == std::string_view::npos)
      ? head.substr(cursor)
      : head.substr(cursor, next - cursor);

    cursor = (next == std::string_view::npos) ? head.size() : next + 2;

    line = StripCR(line);
    if (line.empty()) continue;

    size_t colon = line.find(':');
    if (colon == std::string_view::npos) {
      Napi::Error::New(env, "Invalid HTTP header line").ThrowAsJavaScriptException();
      return env.Null();
    }

    std::string_view key = TrimView(line.substr(0, colon));
    std::string_view value = TrimView(line.substr(colon + 1));

    if (key.empty()) {
      Napi::Error::New(env, "Invalid HTTP header key").ThrowAsJavaScriptException();
      return env.Null();
    }

    AddHeaderValue(env, headers, ToLowerAscii(key), value);
  }

  // Body
  bool chunked = HeaderContains(headers, "transfer-encoding", "chunked");
  std::string decodedBody;

  if (chunked) {
    try {
      decodedBody = DecodeChunkedBody(rawBodyView);
    } catch (const std::exception& e) {
      Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
      return env.Null();
    }
  } else {
    decodedBody.assign(rawBodyView.data(), rawBodyView.size());
  }

  std::string contentType = GetHeaderSingle(headers, "content-type");
  Napi::Value parsedBody = Napi::String::New(env, decodedBody);

  try {
    if (!contentType.empty()) {
      parsedBody = ParseBodyByContentType(env, contentType, decodedBody);
    }
  } catch (...) {
    parsedBody = Napi::String::New(env, decodedBody);
  }

  // Query params
  Napi::Object queryParams = Napi::Object::New(env);
  if (!query.empty()) {
    std::string_view q(query);
    size_t start = 0;

    while (start <= q.size()) {
      size_t amp = q.find('&', start);
      std::string_view pair = (amp == std::string_view::npos)
        ? q.substr(start)
        : q.substr(start, amp - start);

      if (!pair.empty()) {
        size_t eq = pair.find('=');
        std::string key = UrlDecode(eq == std::string_view::npos ? pair : pair.substr(0, eq));
        std::string value = UrlDecode(eq == std::string_view::npos ? "" : pair.substr(eq + 1));
        queryParams.Set(key, value);
      }

      if (amp == std::string_view::npos) break;
      start = amp + 1;
    }
  }

  bool keepAlive = ShouldKeepAlive(httpVersion, headers);

  Napi::Object req = Napi::Object::New(env);
  req.Set("ok", true);
  req.Set("method", method);
  req.Set("fullPath", fullPath);
  req.Set("pathname", pathname);
  req.Set("query", query);
  req.Set("queryParams", queryParams);
  req.Set("httpVersion", httpVersion);
  req.Set("headers", headers);
  req.Set("rawBody", std::string(rawBodyView));
  req.Set("body", decodedBody);
  req.Set("parsedBody", parsedBody);
  req.Set("chunked", chunked);
  req.Set("keepAlive", keepAlive);
  req.Set("contentType", contentType);
  req.Set("contentLength", static_cast<double>(decodedBody.size()));
  req.Set("raw", raw);

  return req;
}

Napi::Value BuildHttpResponse(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "buildHttpResponse expects an object").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Object opts = info[0].As<Napi::Object>();

  int status = 200;
  if (opts.Has("status") && opts.Get("status").IsNumber()) {
    status = opts.Get("status").As<Napi::Number>().Int32Value();
  }

  std::string statusText = StatusText(status);
  if (opts.Has("statusText") && opts.Get("statusText").IsString()) {
    statusText = opts.Get("statusText").As<Napi::String>().Utf8Value();
  }

  Napi::Object headers = Napi::Object::New(env);
  if (opts.Has("headers") && opts.Get("headers").IsObject()) {
    Napi::Object inHeaders = opts.Get("headers").As<Napi::Object>();
    Napi::Array props = inHeaders.GetPropertyNames();

    for (uint32_t i = 0; i < props.Length(); ++i) {
      std::string key = ToLowerAscii(props.Get(i).ToString().Utf8Value());
      Napi::Value val = inHeaders.Get(props.Get(i));

      if (val.IsArray()) {
        Napi::Array arr = val.As<Napi::Array>();
        for (uint32_t j = 0; j < arr.Length(); ++j) {
          AddHeaderValue(env, headers, key, arr.Get(j).ToString().Utf8Value());
        }
      } else {
        AddHeaderValue(env, headers, key, val.ToString().Utf8Value());
      }
    }
  }

  std::string body;
  bool jsonLike = false;
  if (opts.Has("body")) {
    body = ValueToStringLike(opts.Get("body"), env, jsonLike);
  }

  bool keepAlive = true;
  if (opts.Has("keepAlive") && opts.Get("keepAlive").IsBoolean()) {
    keepAlive = opts.Get("keepAlive").ToBoolean().Value();
  }

  if (!headers.Has("content-type")) {
    headers.Set("content-type", jsonLike ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
  }

  headers.Set("content-length", std::to_string(body.size()));
  headers.Set("connection", keepAlive ? "keep-alive" : "close");

  std::ostringstream out;
  out << "HTTP/1.1 " << status << " " << statusText << "\r\n";

  Napi::Array names = headers.GetPropertyNames();
  for (uint32_t i = 0; i < names.Length(); ++i) {
    Napi::Value nameV = names.Get(i);
    std::string key = nameV.ToString().Utf8Value();
    Napi::Value val = headers.Get(nameV);

    if (val.IsArray()) {
      Napi::Array arr = val.As<Napi::Array>();
      for (uint32_t j = 0; j < arr.Length(); ++j) {
        out << key << ": " << arr.Get(j).ToString().Utf8Value() << "\r\n";
      }
    } else {
      out << key << ": " << val.ToString().Utf8Value() << "\r\n";
    }
  }

  out << "\r\n";
  out << body;

  return Napi::String::New(env, out.str());
}

Napi::Value IsKeepAlive(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsObject()) {
    Napi::TypeError::New(env, "isKeepAlive expects (httpVersion, headers)").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::string httpVersion = info[0].As<Napi::String>().Utf8Value();
  Napi::Object headers = info[1].As<Napi::Object>();
  return Napi::Boolean::New(env, ShouldKeepAlive(httpVersion, headers));
}

Napi::Value DecodeChunked(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "decodeChunked expects a string").ThrowAsJavaScriptException();
    return env.Null();
  }

  try {
    std::string raw = info[0].As<Napi::String>().Utf8Value();
    std::string_view view(raw);
    std::string decoded = DecodeChunkedBody(view);
    return Napi::String::New(env, decoded);
  } catch (const std::exception& e) {
    Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
    return env.Null();
  }
}

Napi::Object InitImpl(Napi::Env env, Napi::Object exports) {
  exports.Set("hello", Napi::Function::New(env, Hello));
  exports.Set("parseHttpRequest", Napi::Function::New(env, ParseHttpRequest));
  exports.Set("buildHttpResponse", Napi::Function::New(env, BuildHttpResponse));
  exports.Set("isKeepAlive", Napi::Function::New(env, IsKeepAlive));
  exports.Set("decodeChunked", Napi::Function::New(env, DecodeChunked));
  exports.Set("setLogFile", Napi::Function::New(env, SetLogFile));
  exports.Set("log", Napi::Function::New(env, Log));
  exports.Set("getMetrics", Napi::Function::New(env, GetMetrics));
  return exports;
}

}  // namespace nitro5

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  return nitro5::InitImpl(env, exports);
}

NODE_API_MODULE(nitro5, Init)
